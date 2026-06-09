/**
 * POST /api/room-availability
 * Google Apps Script から呼ばれ、各リソースカレンダーの当日予定を
 * reception_room_availability テーブルへ upsert する。
 *
 * body: {
 *   date:   "yyyy-MM-dd",
 *   rooms:  [{ calendar_id, events: [{ title, start:"HH:mm", end:"HH:mm" }] }],
 *   secret?: string
 * }
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

  const { date, rooms, secret } = req.body || {};

  // 簡易認証
  const invSecret = process.env.INVITATION_SECRET;
  if (invSecret && secret !== invSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  if (!date || !Array.isArray(rooms)) {
    return res.status(400).json({ error: "date and rooms required" });
  }

  try {
    const upserts = rooms.map(r => ({
      calendar_id: r.calendar_id,
      date,
      events:     Array.isArray(r.events) ? r.events : [],
      synced_at:  new Date().toISOString(),
    }));

    const { error } = await sb()
      .from("reception_room_availability")
      .upsert(upserts, { onConflict: "calendar_id,date" });

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, synced: upserts.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
