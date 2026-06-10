/**
 * GET   /api/invitation?token=QR_TOKEN  → 招待状取得（キオスクQRスキャン用）
 * POST  /api/invitation                 → 招待状作成（管理画面 / Google Apps Script 連携）
 * PATCH /api/invitation                 → ステータス更新
 */

const { createClient } = require("@supabase/supabase-js");

const BASE_URL = "https://reception-eureka.com";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/** Supabase settings から複数キーを一括取得 */
async function getSettings(...keys) {
  try {
    const { data } = await sb()
      .from("reception_settings")
      .select("key, value")
      .in("key", keys);
    const map = {};
    (data || []).forEach(r => {
      // jsonb の文字列値はクォートを含む場合があるので除去
      map[r.key] = typeof r.value === "string"
        ? r.value.replace(/^"|"$/g, "")
        : r.value;
    });
    return map;
  } catch { return {}; }
}

/** Google Chat に通知を送る */
async function notifyChat(webhookUrl, text) {
  if (!webhookUrl) return;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) console.error("Chat notify HTTP error:", res.status, await res.text());
  } catch (e) { console.error("Chat notify error:", e); }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  /* ── GET: QRトークンで招待状を取得（会社情報も付与） ── */
  if (req.method === "GET") {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: "token required" });

    const [invResult, settings] = await Promise.all([
      sb()
        .from("reception_invitations")
        .select("id, visitor_name, company_name, host_name, visit_date, visit_time, purpose, notes, room, status, qr_token")
        .eq("qr_token", token)
        .maybeSingle(),
      getSettings("company_address", "company_phone", "company_logo"),
    ]);

    if (invResult.error) return res.status(500).json({ error: invResult.error.message });
    if (!invResult.data) return res.status(404).json({ error: "not found" });

    return res.json({
      ...invResult.data,
      company_address: settings.company_address || null,
      company_phone:   settings.company_phone   || null,
      company_logo:    settings.company_logo    || null,
    });
  }

  /* ── POST: 招待状を作成 ── */
  if (req.method === "POST") {
    const {
      visitor_name, company_name, host_name,
      visit_date, visit_time, purpose, notes, room,
      secret, source,
    } = req.body || {};

    const invSecret = process.env.INVITATION_SECRET;
    if (invSecret && secret !== invSecret) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (!visitor_name) return res.status(400).json({ error: "visitor_name required" });

    const { data, error } = await sb()
      .from("reception_invitations")
      .insert({
        visitor_name,
        company_name: company_name || null,
        host_name:    host_name    || null,
        visit_date:   visit_date   || null,
        visit_time:   visit_time   || null,
        purpose:      purpose      || null,
        notes:        notes        || null,
        room:         room         || null,
        status:       "pending",
      })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // ── Chat 通知（設定から webhook_url を読む） ──
    const settings = await getSettings("webhook_url");
    const webhookUrl = settings.webhook_url || process.env.GOOGLE_CHAT_WEBHOOK_URL;
    if (webhookUrl && data) {
      const label      = company_name ? `${visitor_name}（${company_name}）` : visitor_name;
      const inviteUrl  = `${BASE_URL}/invite.html?token=${encodeURIComponent(data.qr_token)}`;
      const visitDt    = [visit_date, visit_time].filter(Boolean).join(" ");
      const roomPart   = room ? `　🚪 ${room}` : "";
      const hostPart   = host_name ? `　担当: ${host_name}` : "";
      const fromCalendar = source === "calendar";
      await notifyChat(webhookUrl,
        (fromCalendar ? `📅 Googleカレンダーから招待状を自動作成しました\n` : `🔔 招待状を作成しました\n`)
        + `👤 ${label}\n`
        + `📅 ${visitDt}${hostPart}${roomPart}\n`
        + `\n📱 LINE等で共有する場合はこのURLをコピー\n${inviteUrl}`
      );
    }

    return res.status(201).json(data);
  }

  /* ── PATCH: ステータス更新 ── */
  if (req.method === "PATCH") {
    const { id, status, secret } = req.body || {};
    if (!id) return res.status(400).json({ error: "id required" });

    // PATCH も secret チェック（POST と同様）
    const invSecret = process.env.INVITATION_SECRET;
    if (invSecret && secret !== invSecret) {
      return res.status(401).json({ error: "unauthorized" });
    }

    // ステータスの allowlist
    const VALID_STATUSES = ["pending", "arrived", "no_show", "cancelled"];
    const newStatus = status || "arrived";
    if (!VALID_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: "invalid status" });
    }

    // arrived 以外は arrived_at をセットしない
    const updateData = {
      status: newStatus,
      ...(newStatus === "arrived" ? { arrived_at: new Date().toISOString() } : { arrived_at: null }),
    };

    const { data, error } = await sb()
      .from("reception_invitations")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  return res.status(405).end();
};
