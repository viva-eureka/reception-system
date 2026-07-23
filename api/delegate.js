/**
 * GET /api/delegate
 * Google Chat の「他の人に対応を依頼」ボタンから呼ばれる。
 * セッションクッキーがあれば OAuth をスキップして即時通知。
 * なければ Google OAuth でログインユーザーを自動識別して callback で通知する。
 *
 * 必須環境変数:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_CHAT_WEBHOOK_URL（クッキーセッション時）
 */

const { createClient } = require("@supabase/supabase-js");

const BASE_URL     = "https://reception-eureka.com";
const CALLBACK_URI = `${BASE_URL}/api/auth/callback`;

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach(c => {
    const [k, ...v] = c.trim().split("=");
    if (k) cookies[k.trim()] = decodeURIComponent(v.join("="));
  });
  return cookies;
}

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

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).end();

  const q = req.query || {};
  const { visitId, visitor, company } = q;
  const subtitle = company ? `${visitor}（${company}）` : (visitor || "");

  // クッキーにセッションがあれば OAuth をスキップして即時処理
  const cookies = parseCookies(req);
  if (cookies.reception_staff) {
    try {
      const staffInfo = JSON.parse(Buffer.from(cookies.reception_staff, "base64url").toString());
      const responderName  = staffInfo.name  || staffInfo.email || "不明";

      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || null);

      // 同じ来訪への重複依頼通知を防ぐ
      let alreadyDelegated = false;
      if (visitId) {
        const { data } = await sb.from("reception_audit_logs")
          .select("id")
          .eq("action", "delegate_request")
          .eq("record_id", visitId)
          .limit(1)
          .maybeSingle()
          .catch(() => ({ data: null }));
        alreadyDelegated = !!data;
      }

      const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
      if (!alreadyDelegated && webhookUrl) {
        const message = subtitle
          ? `⚠️ *取り込み中のため、どなたか対応をお願いします。*\n来訪者: ${subtitle}\n（by ${responderName}）`
          : `⚠️ *取り込み中のため、どなたか対応をお願いします。*\n（by ${responderName}）`;
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: message }),
        }).catch(e => console.error("chat delegate error:", e));
      }

      await sb.from("reception_audit_logs").insert({
        action:     "delegate_request",
        table_name: "reception_responders",
        record_id:  visitId || null,
        actor_name: responderName,
        user_email: staffInfo.email || "",
        new_data:   { visitor, company, duplicate: alreadyDelegated },
        ip_address: ip,
        user_agent: req.headers["user-agent"] || null,
      }).catch(e => console.error("audit log error:", e));

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(doneHtml(
        "📨",
        alreadyDelegated
          ? `依頼は既にスペースへ送信済みです。<br><b>${responderName}</b> さん、少々お待ちください。`
          : `スペースに依頼メッセージを送りました。<br><b>${responderName}</b> さん、少々お待ちください。`,
        "#fef9ec"
      ));
    } catch (e) {
      console.error("cookie session error:", e);
      // クッキーが壊れていた場合は OAuth フローにフォールバック
    }
  }

  // OAuth フロー
  const state = Buffer.from(JSON.stringify({
    action:  "delegate",
    visitId: visitId || "",
    visitor: visitor || "",
    company: company || "",
  })).toString("base64url");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (!clientId) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<!DOCTYPE html><html lang="ja"><body>
      <p>GOOGLE_OAUTH_CLIENT_ID が未設定です</p></body></html>`);
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id",     clientId);
  authUrl.searchParams.set("redirect_uri",  CALLBACK_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope",         "openid email profile");
  authUrl.searchParams.set("state",         state);
  authUrl.searchParams.set("hd",            "viva-eureka.co.jp");
  authUrl.searchParams.set("access_type",   "online");

  res.redirect(302, authUrl.toString());
};
