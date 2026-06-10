/**
 * GET /api/audit-logs
 * 監査ログ一覧を返す（reception_audit_logs）
 * visitor-log.html から呼び出す。
 * Supabase anon では RLS でブロックされるため service_role 経由でアクセスする。
 *
 * query params:
 *   filter  : today | week | month | all  (default: today)
 *   limit   : number (default: 500)
 */

const { createClient } = require("@supabase/supabase-js");

function cors(req, res) {
  const ALLOWED = [
    "https://reception-system-five.vercel.app",
    "http://localhost:3000",
  ];
  const origin = req.headers.origin || "";
  const allowed = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function sb() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function getDateRange(filter) {
  const now = new Date();
  if (filter === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end   = new Date(start.getTime() + 86400000);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (filter === "week") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const nextMon = new Date(monday.getTime() + 7 * 86400000);
    return { start: monday.toISOString(), end: nextMon.toISOString() };
  }
  if (filter === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return null; // all
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const filter = req.query.filter || "today";
  const limit  = Math.min(parseInt(req.query.limit || "500", 10), 1000);

  try {
    const range = getDateRange(filter);

    let query = sb()
      .from("reception_audit_logs")
      .select("id,action,actor_name,user_email,new_data,ip_address,created_at,table_name,record_id")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (range) {
      query = query
        .gte("created_at", range.start)
        .lt("created_at", range.end);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.json(data || []);
  } catch (err) {
    console.error("audit-logs error:", err);
    return res.status(500).json({ error: err.message });
  }
};
