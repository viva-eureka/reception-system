/**
 * POST /api/sync-rooms
 * Google Apps Script から呼ばれ、Workspace のリソースカレンダー一覧を
 * reception_rooms テーブルに同期する。
 *
 * body: { rooms: [{ name, calendar_id, capacity, sort_order }], secret? }
 */

const { createClient } = require("@supabase/supabase-js");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { rooms, secret } = req.body || {};

  // 簡易認証
  const invSecret = process.env.INVITATION_SECRET;
  if (invSecret && secret !== invSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (!Array.isArray(rooms) || rooms.length === 0) {
    return res.status(400).json({ error: "rooms array required" });
  }

  try {
    // calendar_id が一致するものは upsert、なければ insert
    const upsertData = rooms.map((r, i) => ({
      name:        r.name,
      calendar_id: r.calendar_id || null,
      capacity:    r.capacity    || null,
      sort_order:  r.sort_order  ?? i,
      is_active:   true,
    }));

    const { error } = await sb()
      .from("reception_rooms")
      .upsert(upsertData, { onConflict: "calendar_id", ignoreDuplicates: false });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, synced: upsertData.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
