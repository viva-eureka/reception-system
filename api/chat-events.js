/**
 * POST /api/chat-events
 * Google Chat App からのイベントを受け取るエンドポイント。
 * ボタンクリック（CARD_CLICKED）で対応者を自動識別して処理する。
 *
 * 必須環境変数:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

const { createClient } = require("@supabase/supabase-js");

function getParam(params, key) {
  return (params || []).find((p) => p.key === key)?.value || "";
}

/* 「対応済み」カードに更新する */
function buildHandledCard(visitor, company, responderName, respondedAt) {
  const subtitle = company ? `${visitor}（${company}）` : visitor;
  return {
    cardsV2: [{
      cardId: "handled-card",
      card: {
        header: { title: "✅ 対応済み", subtitle },
        sections: [{
          widgets: [{
            decoratedText: {
              startIcon: { knownIcon: "PERSON" },
              text: `<b>${responderName}</b> が対応しました（${respondedAt}）`,
            },
          }],
        }],
      },
    }],
  };
}

/* 「依頼済み」カードに更新する */
function buildDelegatedCard(visitor, company, requesterName, requestedAt) {
  const subtitle = company ? `${visitor}（${company}）` : visitor;
  return {
    cardsV2: [{
      cardId: "delegated-card",
      card: {
        header: { title: "📨 対応依頼中", subtitle },
        sections: [{
          widgets: [{
            decoratedText: {
              startIcon: { knownIcon: "DESCRIPTION" },
              text: `<b>${requesterName}</b> が依頼しました（${requestedAt}）`,
            },
          }],
        }],
      },
    }],
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  const event = req.body;

  /* Bot がスペースに追加された */
  if (event.type === "ADDED_TO_SPACE") {
    console.log("Bot added to space:", event.space?.name);
    return res.json({ text: "受付システム Bot が起動しました 🎉" });
  }

  /* メッセージ（メンションなど） */
  if (event.type === "MESSAGE") {
    return res.json({ text: "受付システム Bot です。来訪者が到着するとここに通知が届きます。" });
  }

  /* ── ボタンクリック ── */
  if (event.type === "CARD_CLICKED") {
    const fn             = event.action?.actionMethodName;
    const params         = event.action?.parameters || [];
    const visitId        = getParam(params, "visitId");
    const visitor        = getParam(params, "visitor");
    const company        = getParam(params, "company");
    const responderName  = event.user?.displayName || event.user?.email || "不明";
    const responderEmail = event.user?.email || "";
    const subtitle       = company ? `${visitor}（${company}）` : visitor;
    const now = new Date().toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
    });

    /* ✋ 対応する */
    if (fn === "handle") {
      try {
        const sb = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        await sb.from("reception_responders").insert({
          visit_id:        visitId || null,
          responder_name:  responderName,
          responder_email: responderEmail,
          response_type:   "handling",
        });
      } catch (err) {
        console.error("Supabase insert error:", err);
      }

      const updated = buildHandledCard(visitor, company, responderName, now);
      return res.json({
        actionResponse: { type: "UPDATE_MESSAGE" },
        ...updated,
      });
    }

    /* 他の人に対応を依頼 */
    if (fn === "delegate") {
      const updated = buildDelegatedCard(visitor, company, responderName, now);
      return res.json({
        actionResponse: { type: "NEW_MESSAGE" },
        text: `⚠️ *取り込み中のため、どなたか対応をお願いします。*\n来訪者: ${subtitle}\n（by ${responderName}）`,
      });
    }
  }

  res.json({});
};
