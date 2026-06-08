/**
 * POST /api/notify
 * 来訪者チェックイン時にブラウザから呼ばれ、Google Chat にインタラクティブカードを送信する
 *
 * 必須環境変数:
 *   GOOGLE_CHAT_SPACE_ID   例: spaces/XXXXXXXX
 *   GOOGLE_CREDENTIALS     サービスアカウントJSONを1行に圧縮した文字列
 */

const { GoogleAuth } = require("google-auth-library");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function buildVisitorCard(visitId, visitorName, company, host, room, time) {
  const subtitle = company ? `${visitorName}（${company}）` : visitorName;
  const params = [
    { key: "visitId",      value: String(visitId) },
    { key: "visitorName",  value: String(visitorName) },
    { key: "company",      value: String(company || "") },
    { key: "host",         value: String(host || "") },
    { key: "room",         value: String(room || "") },
    { key: "time",         value: String(time) },
  ];

  return {
    cardsV2: [{
      cardId: `visit-${visitId}`,
      card: {
        header: {
          title: "🙋 来訪者が到着しました",
          subtitle,
        },
        sections: [
          {
            widgets: [
              { decoratedText: { startIcon: { knownIcon: "PERSON"   }, text: `担当: <b>${host || "未設定"}</b>` } },
              { decoratedText: { startIcon: { knownIcon: "CLOCK"    }, text: `受付時刻: ${time}` } },
              ...(room ? [{ decoratedText: { startIcon: { knownIcon: "BOOKMARK" }, text: `会議室: ${room}` } }] : []),
            ],
          },
          {
            widgets: [{
              buttonList: {
                buttons: [{
                  text: "✋ 対応する",
                  color: { red: 0.13, green: 0.59, blue: 0.95, alpha: 1 },
                  onClick: { action: { function: "handleReception", parameters: params } },
                }],
              },
            }],
          },
        ],
      },
    }],
  };
}

function buildDeliveryCard(visitId, time) {
  return {
    cardsV2: [{
      cardId: `visit-${visitId}`,
      card: {
        header: { title: "📦 配送業者が到着しました", subtitle: `受付時刻: ${time}` },
        sections: [{
          widgets: [{
            buttonList: {
              buttons: [{
                text: "✋ 対応する",
                color: { red: 0.95, green: 0.60, blue: 0.13, alpha: 1 },
                onClick: {
                  action: {
                    function: "handleReception",
                    parameters: [
                      { key: "visitId",     value: String(visitId) },
                      { key: "visitorName", value: "配送業者" },
                      { key: "company",     value: "" },
                      { key: "host",        value: "" },
                      { key: "room",        value: "" },
                      { key: "time",        value: String(time) },
                    ],
                  },
                },
              }],
            },
          }],
        }],
      },
    }],
  };
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const spaceId     = process.env.GOOGLE_CHAT_SPACE_ID;
  const credsJson   = process.env.GOOGLE_CREDENTIALS;

  if (!spaceId || !credsJson) {
    // Google Chat 未設定の場合は 204 で黙って成功（アプリ側はブロックしない）
    return res.status(204).end();
  }

  const { visitId, visitorName, company, host, room, time, isDelivery } = req.body;

  try {
    const credentials = JSON.parse(credsJson);
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const card = isDelivery
      ? buildDeliveryCard(visitId, time)
      : buildVisitorCard(visitId, visitorName, company, host, room, time);

    const chatRes = await fetch(
      `https://chat.googleapis.com/v1/${spaceId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(card),
      }
    );

    if (!chatRes.ok) {
      const errText = await chatRes.text();
      console.error("Google Chat API error:", errText);
      return res.status(502).json({ error: errText });
    }

    const data = await chatRes.json();
    return res.json({ ok: true, name: data.name });
  } catch (err) {
    console.error("notify error:", err);
    return res.status(500).json({ error: err.message });
  }
};
