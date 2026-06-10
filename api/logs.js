/**
 * GET /api/logs
 * 来訪ログまたは監査ログを返す。
 * visitor-log.html から呼び出す。
 * Supabase anon では RLS でブロックされるため service_role 経由でアクセスする。
 *
 * query params:
 *   type    : visit | audit  (必須)
 *   filter  : today | week | month | all  (default: today)
 *   limit   : number (default: visit=200, audit=500)
 */

const { createClient } = require("@supabase/supabase-js");

const ALLOWED = [
  "https://reception-eureka.com",
  "https://reception-system-five.vercel.app",
  "http://localhost:3000",
];

function cors(req, res) {
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

async function handleVisitLogs(req, res) {
  const filter = req.query.filter || "today";
  const limit  = Math.min(parseInt(req.query.limit || "200", 10), 500);
  const range  = getDateRange(filter);
  const client = sb();

  let query = client
    .from("reception_visits")
    .select("id,visitor_name,company_name,visit_type,host_name,person_count,visit_purpose,checked_in_at,checked_out_at")
    .order("checked_in_at", { ascending: false })
    .limit(limit);

  if (range) {
    query = query.gte("checked_in_at", range.start).lt("checked_in_at", range.end);
  }

  const { data: visits, error: visitErr } = await query;
  if (visitErr) return res.status(500).json({ error: visitErr.message });
  if (!visits || visits.length === 0) return res.json([]);

  // 対応者をマージ
  const visitIds = visits.map(v => v.id);
  const { data: responders, error: respErr } = await client
    .from("reception_responders")
    .select("visit_id,responder_name,responder_email,response_type,responded_at")
    .in("visit_id", visitIds);

  if (respErr) console.error("responders fetch error:", respErr);

  const responderMap = {};
  (responders || []).forEach(r => {
    if (!responderMap[r.visit_id]) responderMap[r.visit_id] = r;
  });

  return res.json(visits.map(v => ({ ...v, responder: responderMap[v.id] || null })));
}

async function handleAuditLogs(req, res) {
  const filter = req.query.filter || "today";
  const limit  = Math.min(parseInt(req.query.limit || "500", 10), 1000);
  const range  = getDateRange(filter);

  let query = sb()
    .from("reception_audit_logs")
    .select("id,action,actor_name,user_email,new_data,ip_address,created_at,table_name,record_id")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (range) {
    query = query.gte("created_at", range.start).lt("created_at", range.end);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).end();

  const type = req.query.type;
  try {
    if (type === "visit")  return await handleVisitLogs(req, res);
    if (type === "audit")  return await handleAuditLogs(req, res);
    return res.status(400).json({ error: "type must be 'visit' or 'audit'" });
  } catch (err) {
    console.error("logs error:", err);
    return res.status(500).json({ error: err.message });
  }
};
