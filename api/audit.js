/**
 * POST /api/audit
 * クライアント（ブラウザ）からの監査ログを Supabase に記録する。
 *
 * body: {
 *   action:     string   // イベント種別
 *   table_name: string   // 対象テーブル（任意）
 *   record_id:  string   // 対象レコードID（任意）
 *   actor_name: string   // 操作者名（任意）
 *   user_email: string   // 操作者メール（任意）
 *   new_data:   object   // 詳細情報（任意）
 * }
 */

const { createClient } = require("@supabase/supabase-js");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { action, table_name, record_id, actor_name, user_email, new_data } = req.body || {};
  if (!action) return res.status(400).json({ error: "action required" });

  // アクション種別のallowlist（不正なデータの書き込みを防止）
  const ALLOWED_ACTIONS = [
    "admin_login", "admin_logout", "settings_change", "pin_change",
    "apikey_save", "invitation_create", "invitation_cancel",
    "visit_checkin", "delivery_checkin", "handle_response", "delegate_request",
    "log_viewed",
  ];
  if (!ALLOWED_ACTIONS.includes(action)) {
    return res.status(400).json({ error: "invalid action" });
  }

  const ip = (
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket?.remoteAddress ||
    null
  );
  const ua = req.headers["user-agent"] || null;

  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    await sb.from("reception_audit_logs").insert({
      action,
      table_name:  table_name || null,
      record_id:   record_id  || null,
      actor_name:  actor_name || null,
      user_email:  user_email || null,
      new_data:    new_data   || null,
      ip_address:  ip,
      user_agent:  ua,
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("audit error:", err);
    return res.status(500).json({ error: err.message });
  }
};
