// ============================================================
//  reception-calendar.gs
//  Googleカレンダー → 受付招待状自動発行
//
//  【セットアップ手順】
//  1. Google Apps Script (script.google.com) で新しいプロジェクトを作成
//  2. このコードを貼り付ける
//  3. 左メニュー「サービス」> 「Google Calendar API」を追加
//  4. setSecretOnce() を編集してシークレットを入力し、一度だけ手動実行
//  5. setupTrigger() を一度だけ手動実行してトリガーを登録
//  6. setSecretOnce() の中身のシークレット値を削除して保存（セキュリティのため）
// ============================================================

const RECEPTION_URL   = "https://reception-system-five.vercel.app";
const COMPANY_DOMAIN  = "viva-eureka.co.jp"; // 自社ドメイン（社外判定に使用）

// 個人ドメイン扱いして会社名推測をスキップするドメイン
const PERSONAL_DOMAINS = ["gmail.com", "yahoo.co.jp", "yahoo.com", "outlook.com",
                           "hotmail.com", "icloud.com", "me.com", "live.com"];

// ─────────────────────────────────────────────────────────────
//  メイントリガー関数
//  Apps Script > トリガー > onCalendarEventUpdated
//  「カレンダーから」「更新時（イベントの更新）」に設定
// ─────────────────────────────────────────────────────────────
function onCalendarEventUpdated(e) {
  const calendarId = e.calendarId;
  const props      = PropertiesService.getScriptProperties();
  const now        = new Date();

  // 前回スキャン時刻を読む（初回は 10分前）
  const defaultSince = new Date(now.getTime() - 10 * 60 * 1000);
  const lastScan     = new Date(props.getProperty("lastScanTime") || defaultSince.toISOString());

  // 次回のために現在時刻を保存（処理中に再トリガーされても重複しないよう先に書く）
  props.setProperty("lastScanTime", now.toISOString());

  // Calendar API でupdatedMin 以降のイベントを取得（高度なサービスが必要）
  let pageToken = null;
  do {
    const opts = {
      updatedMin:    lastScan.toISOString(),
      maxResults:    50,
      singleEvents:  true,
      showDeleted:   false,
    };
    if (pageToken) opts.pageToken = pageToken;

    let result;
    try {
      result = Calendar.Events.list(calendarId, opts);
    } catch (err) {
      Logger.log("Calendar.Events.list エラー: " + err);
      return;
    }

    for (const ev of (result.items || [])) {
      // 「作成日時」が lastScan より前 = 既存イベントの更新 → スキップ
      if (!ev.created || new Date(ev.created) < lastScan) continue;

      // 重複処理防止（イベントIDをプロパティに記録）
      const doneKey = "inv_" + ev.id.replace(/[^a-z0-9]/gi, "_");
      if (props.getProperty(doneKey)) continue;
      props.setProperty(doneKey, "1");

      // 社外ゲストを抽出（自分・社内・リソースカレンダーを除外）
      const attendees     = ev.attendees || [];
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

      // ホスト名（このスクリプトを動かしているユーザー）
      const hostEmail = Session.getActiveUser().getEmail();
      const hostName  = formatHostName(hostEmail);

      // 来訪日時
      const tz        = Session.getScriptTimeZone();
      const startDt   = ev.start.dateTime ? new Date(ev.start.dateTime) : new Date(ev.start.date);
      const visitDate = Utilities.formatDate(startDt, tz, "yyyy-MM-dd");
      const visitTime = ev.start.dateTime ? Utilities.formatDate(startDt, tz, "HH:mm") : null;

      // 各社外ゲストに招待状を発行
      for (var i = 0; i < externalGuests.length; i++) {
        var guest       = externalGuests[i];
        var visitorName = guest.displayName || guest.email.split("@")[0];
        var companyName = guessCompanyFromEmail(guest.email);

        var result = createReceptionInvitation({
          visitor_name: visitorName,
          company_name: companyName,
          host_name:    hostName,
          visit_date:   visitDate,
          visit_time:   visitTime,
          room:         room || null,
          purpose:      ev.summary || null,
          source:       "calendar",      // APIのチャット通知でカレンダー由来と判定
        });

        if (result) {
          Logger.log("✅ 招待作成: " + visitorName + " (" + visitDate + ")");
        }
      }
    }

    pageToken = result.nextPageToken || null;
  } while (pageToken);
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
      method:          "post",
      contentType:     "application/json",
      payload:         payload,
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
//  ユーティリティ
// ─────────────────────────────────────────────────────────────

/** メールアドレスからホスト表示名を生成（aoyama.masashi → 青山 雅司 は無理なので英字のまま） */
function formatHostName(email) {
  var local = email.split("@")[0]; // "aoyama.masashi"
  // "." を空白に置換して先頭大文字化
  return local.split(".").map(function(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }).join(" ");
}

/** メールドメインから会社名を推測（個人ドメインは空文字を返す） */
function guessCompanyFromEmail(email) {
  var domain = (email || "").split("@")[1] || "";
  if (!domain) return "";
  if (PERSONAL_DOMAINS.indexOf(domain) !== -1) return "";
  // .co.jp / .com / .jp / .net / .org の前を取り出す
  var name = domain
    .replace(/\.(co\.jp|com\.jp|or\.jp|ne\.jp|ac\.jp)$/, "")
    .replace(/\.(jp|com|net|org|io)$/, "");
  return name || "";
}

// ─────────────────────────────────────────────────────────────
//  セットアップ用ヘルパー（一度だけ手動実行）
// ─────────────────────────────────────────────────────────────

/**
 * installable トリガーを登録する
 * Apps Script エディタで一度だけ手動実行してください
 */
function setupTrigger() {
  // 重複登録を防ぐため既存を削除
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onCalendarEventUpdated") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("onCalendarEventUpdated")
    .forUserCalendar(Session.getActiveUser().getEmail())
    .onEventUpdated()
    .create();

  Logger.log("✅ トリガーを登録しました: " + Session.getActiveUser().getEmail());
}

/**
 * INVITATION_SECRET をスクリプトプロパティに保存する
 * 1. 下の "ここに入力" を Vercel の INVITATION_SECRET 環境変数と同じ値に書き換える
 * 2. この関数を一度だけ手動実行する
 * 3. 実行後、下の文字列を削除して上書き保存する（コードにシークレットを残さない）
 */
function setSecretOnce() {
  PropertiesService.getScriptProperties().setProperty(
    "INVITATION_SECRET",
    "ここに入力" // ← Vercel > Settings > Environment Variables の INVITATION_SECRET と同じ値
  );
  Logger.log("✅ INVITATION_SECRET を保存しました");
}
