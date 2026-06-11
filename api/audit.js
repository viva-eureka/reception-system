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
    "log_viewed", "pin_reset",
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

    // ── PIN リセット処理 ──────────────────────────────────────────
    if (action === "pin_reset") {
      const newPin = String(Math.floor(1000 + Math.random() * 9000));

      // Supabase に新 PIN を保存
      const { error: updateErr } = await sb
        .from("reception_settings")
        .upsert({ key: "admin_pin", value: newPin }, { onConflict: "key" });
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Chat Webhook URL を設定から取得（notify.js と同じキー名 webhook_url を使用）
      const { data: wRow } = await sb.from("reception_settings")
        .select("value").eq("key", "webhook_url").maybeSingle();
      const rawUrl = wRow?.value;
      const webhookUrl = (typeof rawUrl === "string" ? rawUrl.replace(/^"|"$/g, "") : rawUrl)
        || process.env.GOOGLE_CHAT_WEBHOOK_URL;

      let notifiedChat = false;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `🔑 *管理画面PINがリセットされました*\n新しいPIN: \`${newPin}\`\n\n管理画面にログイン後、すぐにPINを変更してください。`,
          }),
        }).catch(e => console.error("chat webhook error:", e));
        notifiedChat = true;
      }

      // メール通知（RESEND_API_KEY + admin_email が設定されている場合）
      let notifiedEmail = false;
      const resendKey = process.env.RESEND_API_KEY;
      const { data: eRow } = await sb.from("reception_settings")
        .select("value").eq("key", "admin_email").maybeSingle();
      const adminEmail = eRow?.value;
      if (resendKey && adminEmail) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "noreply@reception-eureka.com",
            to: [adminEmail],
            subject: "【受付システム】管理PINがリセットされました",
            html: `<p>管理画面のPINコードがリセットされました。</p>
                   <p>新しいPIN: <strong style="font-size:28px;letter-spacing:6px;font-family:monospace">${newPin}</strong></p>
                   <p>管理画面にログイン後、設定からすぐにPINを変更してください。</p>`,
          }),
        }).catch(e => console.error("resend error:", e));
        notifiedEmail = true;
      }

      // 監査ログに記録
      await sb.from("reception_audit_logs").insert({
        action: "pin_reset",
        ip_address: ip,
        user_agent: ua,
        new_data: { notified_chat: notifiedChat, notified_email: notifiedEmail },
      });

      return res.json({ ok: true, notified_chat: notifiedChat, notified_email: notifiedEmail, new_pin: newPin });
    }
    // ─────────────────────────────────────────────────────────────

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
