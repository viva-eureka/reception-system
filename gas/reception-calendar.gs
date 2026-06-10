// ============================================================
//  reception-calendar.gs
//  受付システム Google Apps Script — 統合版
//
//  含まれる機能:
//  1. onCalendarEventUpdated  — 外部ゲスト招待 → 招待状自動作成 + ゲストへQRメール送信
//  2. syncRoomAvailability    — 会議室空き状況を15分ごとに同期
//  3. syncRoomsToReception    — 会議室マスタを初回同期（手動実行）
//
//  【セットアップ手順】
//  1. script.google.com で新しいプロジェクトを作成
//  2. このコードを貼り付ける
//  3. 左メニュー「サービス」>「Google Calendar API」を追加
//  4. setSecretOnce() の "ここに入力" を Vercel の INVITATION_SECRET と同じ値に書き換え、一度だけ手動実行
//  5. 実行後、"ここに入力" の文字列を削除して保存（コードにシークレットを残さない）
//  6. setupTrigger() を一度だけ手動実行してトリガーを一括登録
// ============================================================

const RECEPTION_URL   = "https://reception-system-five.vercel.app";
const COMPANY_DOMAIN  = "viva-eureka.co.jp"; // 自社ドメイン（社外ゲスト判定に使用）

// 個人ドメイン扱いにして会社名推測をスキップするドメイン
const PERSONAL_DOMAINS = [
  "gmail.com", "yahoo.co.jp", "yahoo.com", "outlook.com",
  "hotmail.com", "icloud.com", "me.com", "live.com",
];

// ─────────────────────────────────────────────────────────────
//  1. カレンダー更新トリガー
//     外部ゲストが招待されたイベントを検出 → 招待状作成 + ゲストへQRメール送信
//     トリガー設定: 「カレンダーから」→「更新時（イベントの更新）」
// ─────────────────────────────────────────────────────────────
function onCalendarEventUpdated(e) {
  // 同一イベントの複数回発火による重複処理を防ぐ
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 最大10秒待機
  } catch (err) {
    Logger.log("ロック取得タイムアウト（他の実行が処理中）: " + err);
    return;
  }

  try {
    _onCalendarEventUpdatedBody(e);
  } finally {
    lock.releaseLock();
  }
}

function _onCalendarEventUpdatedBody(e) {
  const calendarId = e.calendarId;
  const props      = PropertiesService.getScriptProperties();
  const now        = new Date();

  // 前回スキャン時刻を読む（初回は10分前）
  const defaultSince = new Date(now.getTime() - 10 * 60 * 1000);
  const lastScan     = new Date(props.getProperty("lastScanTime") || defaultSince.toISOString());

  let pageToken = null;

  do {
    const opts = {
      updatedMin:   lastScan.toISOString(),
      maxResults:   50,
      singleEvents: true,
      showDeleted:  false,
    };
    if (pageToken) opts.pageToken = pageToken;

    let result;
    try {
      result = Calendar.Events.list(calendarId, opts);
    } catch (err) {
      Logger.log("Calendar.Events.list エラー: " + err);
      return; // Calendar API 失敗時は lastScanTime を更新しない
    }

    for (const ev of (result.items || [])) {
      // 新規作成イベントのみ対象（既存イベントの更新はスキップ）
      if (!ev.created || new Date(ev.created) < lastScan) continue;

      // 重複処理防止キー（API成功後にセット）
      const doneKey = "inv_" + ev.id.replace(/[^a-z0-9]/gi, "_");
      if (props.getProperty(doneKey)) continue;

      // 社外ゲストを抽出（自分・社内・リソースカレンダーを除外）
      const attendees      = ev.attendees || [];
      const externalGuests = attendees.filter(function(a) {
        if (a.self) return false;
        const email = (a.email || "").toLowerCase();
        return (
          !email.endsWith("@" + COMPANY_DOMAIN) &&
          !email.endsWith(".calendar.google.com")
        );
      });

      if (externalGuests.length === 0) continue;

      // 会議室リソースを取得
      const roomAttendee = attendees.find(function(a) {
        return (a.email || "").endsWith(".calendar.google.com");
      });
      const room = roomAttendee ? (roomAttendee.displayName || "") : "";

      // ホスト名（スクリプト実行ユーザー）
      const hostEmail = Session.getActiveUser().getEmail();
      const hostName  = formatHostName(hostEmail);

      // 来訪日時
      const tz        = Session.getScriptTimeZone();
      const startDt   = ev.start.dateTime ? new Date(ev.start.dateTime) : new Date(ev.start.date);
      const visitDate = Utilities.formatDate(startDt, tz, "yyyy-MM-dd");
      const visitTime = ev.start.dateTime ? Utilities.formatDate(startDt, tz, "HH:mm") : null;
      const visitDt   = Utilities.formatDate(startDt, tz, "yyyy年MM月dd日 HH:mm");

      let allSuccess = true;

      for (var i = 0; i < externalGuests.length; i++) {
        const guest       = externalGuests[i];
        const visitorName = guest.displayName || guest.email.split("@")[0];
        const companyName = guessCompanyFromEmail(guest.email);

        const inv = createReceptionInvitation({
          visitor_name: visitorName,
          company_name: companyName,
          host_name:    hostName,
          visit_date:   visitDate,
          visit_time:   visitTime,
          room:         room || null,
          purpose:      ev.summary || null,
          source:       "calendar",
        });

        if (inv) {
          Logger.log("✅ 招待作成: " + visitorName + " (" + visitDate + ")");
          // ゲストのメールアドレスにQRコードを送信
          sendGuestEmail(guest.email, visitorName, hostName, room, visitDt, inv.qr_token);
        } else {
          allSuccess = false;
        }
      }

      // API 成功時のみ重複防止フラグをセット（失敗時は次回リトライ可能にする）
      if (allSuccess) {
        props.setProperty(doneKey, "1");
      }
    }

    pageToken = result.nextPageToken || null;
  } while (pageToken);

  // ループ完了後に lastScanTime を更新（途中で return した場合は更新しない）
  props.setProperty("lastScanTime", now.toISOString());
}

// ─────────────────────────────────────────────────────────────
//  2. 会議室の空き状況を同期
//     トリガー設定: 時間ベース → 15分ごと
// ─────────────────────────────────────────────────────────────
function syncRoomAvailability() {
  const secret  = PropertiesService.getScriptProperties().getProperty("INVITATION_SECRET") || "";
  const today   = new Date();
  const dateStr = Utilities.formatDate(today, "Asia/Tokyo", "yyyy-MM-dd");

  const cals = CalendarApp.getAllCalendars()
    .filter(c => c.getId().includes("@resource.calendar.google.com"));

  if (!cals.length) {
    Logger.log("⚠️ リソースカレンダーが見つかりません（先に syncRoomsToReception を実行してください）");
    return;
  }

  const rooms = cals.map(c => ({
    calendar_id: c.getId(),
    events: c.getEventsForDay(today).map(ev => ({
      title:   ev.getTitle(),
      start:   Utilities.formatDate(ev.getStartTime(), "Asia/Tokyo", "HH:mm"),
      end:     Utilities.formatDate(ev.getEndTime(),   "Asia/Tokyo", "HH:mm"),
      creator: (ev.getCreators()[0] || "").split("@")[0],
    })),
  }));

  const res = UrlFetchApp.fetch(RECEPTION_URL + "/api/room-availability", {
    method:             "post",
    contentType:        "application/json",
    muteHttpExceptions: true,
    payload:            JSON.stringify({ date: dateStr, rooms, secret }),
  });

  Logger.log("空き状況同期: " + res.getResponseCode()
    + " / " + rooms.length + "室 / "
    + rooms.map(r => r.calendar_id.split("@")[0] + "(" + r.events.length + "件)").join(", "));
}

// ─────────────────────────────────────────────────────────────
//  3. 会議室マスタを初回同期（手動で一度だけ実行）
//     管理画面「会議室」タブの指示に従って実行してください。
// ─────────────────────────────────────────────────────────────
function syncRoomsToReception() {
  const secret = PropertiesService.getScriptProperties().getProperty("INVITATION_SECRET") || "";
  const cals   = CalendarApp.getAllCalendars();
  const rooms  = cals
    .filter(c => c.getId().includes("@resource.calendar.google.com"))
    .map((c, i) => ({
      name:        c.getName().replace(/\s*\(\d+\)\s*$/, "").trim(),
      calendar_id: c.getId(),
      capacity:    null,
      sort_order:  i,
    }));

  if (!rooms.length) {
    Logger.log("⚠️ リソースカレンダーが見つかりません。Googleカレンダーでリソースカレンダーを追加してください。");
    return;
  }

  const res = UrlFetchApp.fetch(RECEPTION_URL + "/api/sync-rooms", {
    method:             "post",
    contentType:        "application/json",
    muteHttpExceptions: true,
    payload:            JSON.stringify({ rooms, secret }),
  });

  if (res.getResponseCode() === 200) {
    Logger.log("✅ 同期完了: " + rooms.length + "件");
    rooms.forEach(r => Logger.log("  " + r.name + " / " + r.calendar_id));
  } else {
    Logger.log("❌ エラー: " + res.getResponseCode() + " " + res.getContentText());
  }
}

// ─────────────────────────────────────────────────────────────
//  招待状作成 API 呼び出し
// ─────────────────────────────────────────────────────────────
function createReceptionInvitation(data) {
  const secret  = PropertiesService.getScriptProperties().getProperty("INVITATION_SECRET") || "";
  const payload = JSON.stringify(Object.assign({}, data, { secret: secret }));

  var res;
  try {
    res = UrlFetchApp.fetch(RECEPTION_URL + "/api/invitation", {
      method:             "post",
      contentType:        "application/json",
      payload:            payload,
      muteHttpExceptions: true,
    });
  } catch (err) {
    Logger.log("招待API呼び出しエラー: " + err);
    return null;
  }

  if (res.getResponseCode() !== 201) {
    Logger.log("招待作成失敗 HTTP " + res.getResponseCode() + ": " + res.getContentText());
    return null;
  }

  try { return JSON.parse(res.getContentText()); }
  catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────
//  ゲストへQRコードをメール送信
// ─────────────────────────────────────────────────────────────
function sendGuestEmail(email, name, host, room, visitDt, qrToken) {
  if (!email || !qrToken) return;

  const inviteUrl = RECEPTION_URL + "/invite.html?token=" + encodeURIComponent(qrToken);
  const qrUrl     = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data="
                  + encodeURIComponent(qrToken);
  const subject   = "【受付QRコード】" + visitDt + " ご来社のご案内";

  const html = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">'
    + '<h2 style="color:#1e293b;margin-bottom:8px">ご来社のご案内</h2>'
    + '<p>' + name + ' 様</p>'
    + '<p style="color:#475569">下記日程でのご来社をお待ちしております。<br>'
    + '受付端末にて QR コードをかざしてください。</p>'
    + '<table style="margin:16px 0;border-collapse:collapse;font-size:14px">'
    + '<tr><td style="padding:4px 16px 4px 0;color:#64748b">日時</td><td>' + visitDt + '</td></tr>'
    + (host ? '<tr><td style="padding:4px 16px 4px 0;color:#64748b">担当</td><td>' + host + '</td></tr>' : '')
    + (room ? '<tr><td style="padding:4px 16px 4px 0;color:#64748b">会議室</td><td>' + room + '</td></tr>' : '')
    + '</table>'
    + '<div style="text-align:center;padding:24px;background:#f8fafc;border-radius:12px;margin:16px 0">'
    + '<img src="' + qrUrl + '" width="240" height="240" alt="受付QRコード"'
    + ' style="display:block;margin:0 auto"/>'
    + '<p style="margin-top:12px;font-size:13px;color:#64748b">受付端末のカメラにかざしてください</p>'
    + '</div>'
    + '<p style="font-size:14px;margin-bottom:8px">📱 スマートフォンからはこちら</p>'
    + '<a href="' + inviteUrl + '" style="display:block;background:#0ea5e9;color:#fff;'
    + 'text-decoration:none;padding:12px;border-radius:8px;text-align:center;font-weight:bold">'
    + 'QRコードを表示する</a>'
    + '<p style="font-size:12px;color:#94a3b8;margin-top:24px">株式会社ユリーカ 受付システム</p>'
    + '</div>';

  try {
    GmailApp.sendEmail(email, subject, "受付QRコードをご確認ください", { htmlBody: html });
    Logger.log("📧 メール送信: " + email);
  } catch (err) {
    Logger.log("メール送信エラー: " + err);
  }
}

// ─────────────────────────────────────────────────────────────
//  ユーティリティ
// ─────────────────────────────────────────────────────────────

/** メールアドレスのローカル部から表示名を生成（aoyama.masashi → Aoyama Masashi） */
function formatHostName(email) {
  var local = email.split("@")[0];
  return local.split(".").map(function(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join(" ");
}

/** メールドメインから会社名を推測（個人ドメインは空文字） */
function guessCompanyFromEmail(email) {
  var domain = (email || "").split("@")[1] || "";
  if (!domain) return "";
  if (PERSONAL_DOMAINS.indexOf(domain) !== -1) return "";
  var name = domain
    .replace(/\.(co\.jp|com\.jp|or\.jp|ne\.jp|ac\.jp)$/, "")
    .replace(/\.(jp|com|net|org|io)$/, "");
  return name || "";
}

// ─────────────────────────────────────────────────────────────
//  セットアップ用ヘルパー（一度だけ手動実行）
// ─────────────────────────────────────────────────────────────

/**
 * トリガーを一括登録する
 * - onCalendarEventUpdated（カレンダー更新時）
 * - syncRoomAvailability（15分ごと）
 * Apps Script エディタで一度だけ手動実行してください。
 */
function setupTrigger() {
  // 既存トリガーをすべて削除（重複防止）
  ScriptApp.getProjectTriggers().forEach(function(t) {
    ScriptApp.deleteTrigger(t);
  });

  // カレンダー更新トリガー
  ScriptApp.newTrigger("onCalendarEventUpdated")
    .forUserCalendar(Session.getActiveUser().getEmail())
    .onEventUpdated()
    .create();

  // 15分ごとの時間トリガー
  ScriptApp.newTrigger("syncRoomAvailability")
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log("✅ トリガーを登録しました:");
  Logger.log("  - onCalendarEventUpdated（カレンダー更新時）");
  Logger.log("  - syncRoomAvailability（15分ごと）");
}

/**
 * INVITATION_SECRET をスクリプトプロパティに保存する
 * 1. "ここに入力" を Vercel の INVITATION_SECRET と同じ値に書き換える
 * 2. この関数を一度だけ手動実行する
 * 3. 実行後、"ここに入力" の文字列を削除して保存（コードにシークレットを残さない）
 */
function setSecretOnce() {
  PropertiesService.getScriptProperties().setProperty(
    "INVITATION_SECRET",
    "ここに入力" // ← Vercel > Settings > Environment Variables の INVITATION_SECRET と同じ値
  );
  Logger.log("✅ INVITATION_SECRET を保存しました");
}
