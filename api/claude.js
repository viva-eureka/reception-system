/**
 * POST /api/claude
 * Anthropic Claude API へのサーバーサイドプロキシ。
 * ブラウザから直接 api.anthropic.com を呼ぶとAPIキーが露出するため、
 * このエンドポイントを経由して呼び出す。
 *
 * 必須環境変数:
 *   ANTHROPIC_API_KEY  （Vercel > Settings > Environment Variables に設定）
 *
 * body: {
 *   model?:      string   // default: claude-haiku-3-5-latest
 *   max_tokens?: number   // default: 512
 *   messages:   [{ role, content }]
 * }
 */

function cors(req, res) {
  const ALLOWED = [
    "https://reception-system-five.vercel.app",
    "http://localhost:3000",
  ];
  const origin = req.headers.origin || "";
  const allowed = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")    return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "ANTHROPIC_API_KEY が未設定です（Vercel 環境変数に設定してください）" });
  }

  const { model = "claude-haiku-4-5", max_tokens = 512, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages が必要です" });
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            apiKey,
        "anthropic-version":    "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens, messages }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error("Anthropic API error:", upstream.status, data);
      return res.status(upstream.status).json({ error: data?.error?.message || "Anthropic API error" });
    }

    return res.json(data);
  } catch (err) {
    console.error("claude proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
};
