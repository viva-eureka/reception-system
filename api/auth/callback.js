/**
 * GET /api/auth/callback
 * Google OAuth コールバック。コードをトークンに交換してユーザー情報を取得し、
 * state に含まれるアクション（handle / delegate）を実行して完了画面を返す。
 *
 * 必須環境変数:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   GOOGLE_CHAT_WEBHOOK_URL
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
const { createClient } = require("@supabase/supabase-js");

const BASE_URL    = "https://reception-eureka.com";
const REDIRECT_URI = `${BASE_URL}/api/auth/callback`;

function doneHtml(icon, message, bg) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>完了</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:${bg};
  display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:20px;padding:40px 32px;text-align:center;
  box-shadow:0 8px 32px rgba(0,0,0,.1);max-width:320px;width:100%;margin:16px}
h1{font-size:56px;margin-bottom:16px}
p{font-size:17px;color:#374151;line-height:1.7}
.countdown{font-size:13px;color:#9ca3af;margin-top:16px}
</style>
</head>
<body>
<div class="card">
  <h1>${icon}</h1>
  <p>${message}</p>
  <p class="countdown" id="cd">このタブは <span id="n">3</span> 秒後に閉じます</p>
</div>
<script>
(function(){
  var n=3, el=document.getElementById('n');
  var t=setInterval(function(){
    n--; el.textContent=n;
    if(n<=0){ clearInterval(t); window.close(); }
  },1000);
})();
</script>
</body></html>`;
}

function errHtml(msg) {
  return doneHtml("⚠️", msg, "#fff7ed");
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const { code, state: stateRaw, error } = req.query || {};

  if (error) {
    return res.status(400).send(errHtml(`Google認証エラー: ${error}`));
  }
  if (!code || !stateRaw) {
    return res.status(400).send(errHtml("不正なリクエストです"));
  }

  // state をデコード
  let stateObj;
  try {
    stateObj = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
  } catch {
    return res.status(400).send(errHtml("state のデコードに失敗しました"));
  }

  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  // 認可コード → アクセストークン
  let tokenData;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  REDIRECT_URI,
        grant_type:    "authorization_code",
      }),
    });
    tokenData = await tokenRes.json();
  } catch (err) {
    console.error("Token exchange error:", err);
    return res.status(500).send(errHtml("トークン取得エラー"));
  }

  if (!tokenData.access_token) {
    console.error("No access_token:", tokenData);
    return res.status(401).send(errHtml("認証に失敗しました"));
  }

  // ユーザー情報を取得
  let userInfo;
  try {
    const uRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    userInfo = await uRes.json();
  } catch (err) {
    console.error("Userinfo error:", err);
    return res.status(500).send(errHtml("ユーザー情報の取得に失敗しました"));
  }

  const responderName  = userInfo.name  || userInfo.email || "不明";
  const responderEmail = userInfo.email || "";

  // 社内ドメインのみ許可（hd パラメータはUIヒントのみでサーバー側で検証が必要）
  const ALLOWED_DOMAIN = "viva-eureka.co.jp";
  if (!responderEmail.endsWith("@" + ALLOWED_DOMAIN)) {
    return res.status(403).send(errHtml("社外のGoogleアカウントでは操作できません。<br>会社アカウント（@viva-eureka.co.jp）でログインしてください。"));
  }

  // 30日間有効なセッションクッキーを設定（次回以降のOAuthをスキップ）
  const staffCookieVal = Buffer.from(JSON.stringify({ name: responderName, email: responderEmail })).toString("base64url");
  res.setHeader("Set-Cookie",
    `reception_staff=${staffCookieVal}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000; Path=/`
  );

  const { action, visitId, visitor, company } = stateObj;
  const subtitle = company ? `${visitor}（${company}）` : (visitor || "");
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;

  // 監査ログ記録ヘルパー
  const auditLog = async (actionName, detail = {}) => {
    try {
      const sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || null);
      await sb.from("reception_audit_logs").insert({
        action:     actionName,
        table_name: "reception_responders",
        record_id:  visitId || null,
        actor_name: responderName,
        user_email: responderEmail,
        new_data:   { visitor, company, ...detail },
        ip_address: ip,
        user_agent: req.headers["user-agent"] || null,
      });
    } catch (e) { console.error("auditLog error:", e); }
  };

  /* ── ✋ 対応する ── */
  if (action === "handle") {
    // Supabase に記録
    try {
      const sb = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      await sb.from("reception_responders").insert({
        visit_id:        visitId || null,
        responder_name:  responderName,
        responder_email: responderEmail,
        response_type:   "handling",
      });
    } catch (err) {
      console.error("Supabase error:", err);
    }

    // Chat に通知
    if (webhookUrl && visitor) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `✅ *${responderName}* が対応します（${subtitle}）`,
          }),
        });
      } catch (err) {
        console.error("Chat handle notify error:", err);
      }
    }

    await auditLog("handle_response");
    return res.send(doneHtml(
      "✅",
      `<b>${responderName}</b> さん<br>対応を記録しました。<br>ありがとうございます！`,
      "#eff6ff"
    ));
  }

  /* ── 他の人に依頼 ── */
  if (action === "delegate") {
    // 監査ログを先に書く（DB の UNIQUE 制約が競合を原子的に防ぐ）
    const sbDel = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const ipDel = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || null);
    const { data: logRows } = await sbDel.from("reception_audit_logs").insert({
      action:     "delegate_request",
      table_name: "reception_responders",
      record_id:  visitId || null,
      actor_name: responderName,
      user_email: responderEmail,
      new_data:   { visitor, company },
      ip_address: ipDel,
      user_agent: req.headers["user-agent"] || null,
    }, { ignoreDuplicates: true }).select("id").catch(e => {
      console.error("audit log insert error:", e);
      return { data: null };
    });

    const isFirst = !!(logRows && logRows.length > 0);
    if (isFirst && webhookUrl) {
      const message = subtitle
        ? `⚠️ *取り込み中のため、どなたか対応をお願いします。*\n来訪者: ${subtitle}\n（by ${responderName}）`
        : `⚠️ *取り込み中のため、どなたか対応をお願いします。*\n（by ${responderName}）`;
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        });
      } catch (err) {
        console.error("Chat delegate error:", err);
      }
    }

    return res.send(doneHtml(
      "📨",
      isFirst
        ? `スペースに依頼メッセージを送りました。<br><b>${responderName}</b> さん、少々お待ちください。`
        : `依頼は既にスペースへ送信済みです。<br><b>${responderName}</b> さん、少々お待ちください。`,
      "#fef9ec"
    ));
  }

  return res.status(400).send(errHtml("不明なアクション"));
};
