/**
 * GET /api/handle
 * Google Chat の「✋ 対応する」ボタンから呼ばれる。
 * Google OAuth でログインユーザーを自動識別して callback で記録する。
 *
 * 必須環境変数:
 *   GOOGLE_OAUTH_CLIENT_ID
 */

const BASE_URL    = "https://reception-system-five.vercel.app";
const CALLBACK_URI = `${BASE_URL}/api/auth/callback`;

module.exports = (req, res) => {
  if (req.method !== "GET") return res.status(405).end();

  const q = req.query || {};

  const state = Buffer.from(JSON.stringify({
    action:  "handle",
    visitId: q.visitId || "",
    visitor: q.visitor || "",
    company: q.company || "",
    host:    q.host    || "",
    room:    q.room    || "",
    time:    q.time    || "",
  })).toString("base64url");

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;

  // OAuth 未設定のフォールバック（ローカル開発用）
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
