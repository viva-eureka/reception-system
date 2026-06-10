/**
 * POST /api/checkout
 * 来訪者の退館処理。Supabase の reception_visits.checked_out_at を更新する。
 *
 * Body (単件): { id: string, checked_out_at?: string }
 * Body (バッチ): { ids: string[], checked_out_at?: string }
 *
 * 必須環境変数:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require("@supabase/supabase-js");

const ALLOWED_ORIGINS = [
  "https://reception-eureka.com",
  "https://reception-system-five.vercel.app",
  "http://localhost:3000",
];

function cors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { id, ids, checked_out_at } = req.body || {};
  const checkedOutAt = checked_out_at || new Date().toISOString();

  // バッチ退館（ids）または単件退館（id）
  const targetIds = ids && Array.isArray(ids) ? ids : id ? [id] : [];
  if (targetIds.length === 0) {
    return res.status(400).json({ error: "id or ids is required" });
  }

  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { error } = await sb
      .from("reception_visits")
      .update({ checked_out_at: checkedOutAt })
      .in("id", targetIds);

    if (error) {
      console.error("checkout update error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, ids: targetIds, checked_out_at: checkedOutAt });
  } catch (err) {
    console.error("checkout error:", err);
    return res.status(500).json({ error: err.message });
  }
};
