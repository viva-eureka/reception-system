/**
 * POST /api/chat-events
 * Google Chat App から呼ばれるエンドポイント（ボタンクリック等）
 *
 * 必須環境変数:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require("@supabase/supabase-js");

function getParam(params, key) {
  return (params || []).find((p) => p.key === key)?.value || "";
}

function buildHandledCard({ visitorName, company, host, room, time }, responderName, respondedAt) {
  const subtitle = company ? `${visitorName}（${company}）` : visitorName;
  return {
    cardsV2: [{
      cardId: "handled-card",
      card: {
        header: { title: "✅ 対応中", subtitle },
        sections: [{
          widgets: [
            ...(host ? [{ decoratedText: { startIcon: { knownIcon: "PERSON"   }, text: `担当: <b>${host}</b>` } }] : []),
            { decoratedText: { startIcon: { knownIcon: "CLOCK"    }, text: `受付時刻: ${time}` } },
            ...(room ? [{ decoratedText: { startIcon: { knownIcon: "BOOKMARK" }, text: `会議室: ${room}` } }] : []),
            { decoratedText: {
              startIcon: { knownIcon: "CONFIRMATION_NUMBER_ICON" },
              text: `<b>${responderName}</b> が対応中（${respondedAt}）`,
            }},
          ],
        }],
      },
    }],
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const event = req.body;

  // 接続確認（Google が最初に送る）
  if (event.type === "ADDED_TO_SPACE" || event.type === "MESSAGE") {
    return res.json({ text: "受付システム Bot が起動しました 🎉" });
  }

  if (event.type === "CARD_CLICKED") {
    const fn = event.action?.actionMethodName;

    if (fn === "handleReception") {
      const params       = event.action?.parameters || [];
      const visitId      = getParam(params, "visitId");
      const visitorName  = getParam(params, "visitorName");
      const company      = getParam(params, "company");
      const host         = getParam(params, "host");
      const room         = getParam(params, "room");
      const time         = getParam(params, "time");
      const responderName  = event.user?.displayName || "不明";
      const responderEmail = event.user?.email || "";
      const now = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

      // Supabase に対応者を記録（service_role キーで）
      try {
        const supabase = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        await supabase.from("reception_responders").insert({
          visit_id:        visitId || null,
          responder_name:  responderName,
          responder_email: responderEmail,
          response_type:   "handling",
        });
      } catch (err) {
        console.error("Supabase insert error:", err);
        // 記録失敗してもカード更新は続ける
      }

      // カードを「対応中」に更新して返す
      const updated = buildHandledCard(
        { visitorName, company, host, room, time },
        responderName,
        now
      );
      return res.json({
        actionResponse: { type: "UPDATE_MESSAGE" },
        ...updated,
      });
    }
  }

  res.json({ text: "OK" });
};
