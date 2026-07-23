/**
 * POST /api/notify
 * 来訪者チェックイン時にブラウザから呼ばれ、
 * Google Chat Incoming Webhook にカードを送信する。
 * 担当者に個人用 Webhook が設定されていれば、DM スペースにも送信する。
 *
 * ボタンは openLink → OAuth で来訪者を識別（ブラウザタブが一瞬開いて閉じる）
 *
 * 必須環境変数:
 *   GOOGLE_CHAT_WEBHOOK_URL
 *   SUPABASE_URL              (スタッフ個別通知のため)
 *   SUPABASE_SERVICE_ROLE_KEY (スタッフ個別通知のため)
 */

const { createClient } = require("@supabase/supabase-js");

const BASE_URL = "https://reception-eureka.com";

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

function buildHandleUrl(visitId, visitorName, company) {
  const p = new URLSearchParams({
    visitId: String(visitId || ""),
    visitor: String(visitorName || ""),
    company: String(company || ""),
  });
  return `${BASE_URL}/api/handle?${p}`;
}

function buildDelegateUrl(visitId, visitorName, company) {
  const p = new URLSearchParams({
    visitId: String(visitId || ""),
    visitor: String(visitorName || ""),
    company: String(company || ""),
  });
  return `${BASE_URL}/api/delegate?${p}`;
}

function buildVisitorCard(visitId, visitorName, company, host, room, time, count, purpose) {
  const nameDisplay = company
    ? `<b>${visitorName} 様</b>（${company}）`
    : `<b>${visitorName} 様</b>`;

  const detailWidgets = [
    { decoratedText: { startIcon: { knownIcon: "PERSON"   }, text: `担当: <b>${host || "未設定"}</b>` } },
    { decoratedText: { startIcon: { knownIcon: "CLOCK"    }, text: `受付時刻: ${time}` } },
    ...(room    ? [{ decoratedText: { startIcon: { knownIcon: "BOOKMARK"        }, text: `会議室: ${room}` } }] : []),
    ...(count   ? [{ decoratedText: { startIcon: { knownIcon: "MULTIPLE_PEOPLE" }, text: `人数: ${count}名` } }] : []),
    ...(purpose ? [{ decoratedText: { startIcon: { knownIcon: "DESCRIPTION"     }, text: `要件: ${purpose}` } }] : []),
  ];

  const handleUrl   = buildHandleUrl(visitId, visitorName, company);
  const delegateUrl = buildDelegateUrl(visitId, visitorName, company);

  return {
    cardsV2: [{
      cardId: `visit-${visitId}`,
      card: {
        header: { title: "🙋 来訪者が到着しました" },
        sections: [
          { widgets: [{ textParagraph: { text: nameDisplay } }] },
          { widgets: detailWidgets },
          {
            widgets: [{
              buttonList: {
                buttons: [
                  {
                    text: "対応する",
                    color: { red: 0.13, green: 0.59, blue: 0.95, alpha: 1 },
                    onClick: { openLink: { url: handleUrl } },
                  },
                  {
                    text: "他の人に依頼",
                    color: { red: 0.6, green: 0.6, blue: 0.6, alpha: 1 },
                    onClick: { openLink: { url: delegateUrl } },
                  },
                ],
              },
            }],
          },
        ],
      },
    }],
  };
}

function buildDeliveryCard(visitId, time) {
  const handleUrl   = buildHandleUrl(visitId, "配送業者", "");
  const delegateUrl = buildDelegateUrl(visitId, "配送業者", "");

  return {
    cardsV2: [{
      cardId: `visit-${visitId}`,
      card: {
        header: { title: "📦 配送業者が到着しました" },
        sections: [
          { widgets: [{ textParagraph: { text: `受付時刻: ${time}` } }] },
          {
            widgets: [{
              buttonList: {
                buttons: [
                  {
                    text: "対応する",
                    color: { red: 0.95, green: 0.60, blue: 0.13, alpha: 1 },
                    onClick: { openLink: { url: handleUrl } },
                  },
                  {
                    text: "他の人に依頼",
                    color: { red: 0.6, green: 0.6, blue: 0.6, alpha: 1 },
                    onClick: { openLink: { url: delegateUrl } },
                  },
                ],
              },
            }],
          },
        ],
      },
    }],
  };
}

/** 担当者の個人用 Webhook を Supabase から取得する */
async function getStaffWebhook(hostName) {
  if (!hostName) return null;
  const skipNames = ["（受付入力）", "（名刺受付）", "（音声受付）", "未設定"];
  if (skipNames.includes(hostName)) return null;
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    const { data } = await sb
      .from("reception_staff")
      .select("notification_webhook")
      .eq("name", hostName)
      .eq("is_active", true)
      .maybeSingle();
    return data?.notification_webhook || null;
  } catch (err) {
    console.error("getStaffWebhook error:", err);
    return null;
  }
}

/** Supabase から Webhook URL を取得（なければ env var にフォールバック） */
async function getWebhookUrl() {
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await sb
      .from("reception_settings")
      .select("value")
      .eq("key", "google_chat_webhook")
      .maybeSingle();
    const url = data?.value?.replace(/^"|"$/g, ""); // jsonb の文字列値をアンクォート
    if (url && url.startsWith("https://")) return url;
  } catch (e) { console.error("getWebhookUrl:", e); }
  return process.env.GOOGLE_CHAT_WEBHOOK_URL || null;
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const webhookUrl = await getWebhookUrl();
  if (!webhookUrl) return res.status(204).end();

  const { visitId, visitorName, company, host, room, time, isDelivery, count, purpose } = req.body || {};

  try {
    const card = isDelivery
      ? buildDeliveryCard(visitId, time)
      : buildVisitorCard(visitId, visitorName, company, host, room, time, count, purpose);

    // グループ通知
    const chatRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
    });

    if (!chatRes.ok) {
      const errText = await chatRes.text();
      console.error("Webhook error:", errText);
      return res.status(502).json({ error: errText });
    }

    // 担当者への個人通知（非同期・失敗しても無視）
    if (!isDelivery && host) {
      const staffWebhook = await getStaffWebhook(host);
      if (staffWebhook) {
        const nameDisplay = company ? `${visitorName} 様（${company}）` : `${visitorName} 様`;
        const lines = [
          `🙋 *${host}* さん、来訪者が到着しました`,
          `👤 ${nameDisplay}`,
          `🕐 受付時刻: ${time}`,
          ...(room    ? [`🚪 会議室: ${room}`]   : []),
          ...(count   ? [`👥 人数: ${count}名`]  : []),
          ...(purpose ? [`📋 要件: ${purpose}`]  : []),
        ];
        const handleUrl   = buildHandleUrl(visitId, visitorName, company);
        const delegateUrl = buildDelegateUrl(visitId, visitorName, company);
        const personalCard = {
          cardsV2: [{
            cardId: `personal-${visitId}`,
            card: {
              header: { title: "🙋 来訪のお知らせ（個人）" },
              sections: [
                { widgets: [{ textParagraph: { text: lines.join("\n") } }] },
                {
                  widgets: [{
                    buttonList: {
                      buttons: [
                        {
                          text: "対応する",
                          color: { red: 0.13, green: 0.59, blue: 0.95, alpha: 1 },
                          onClick: { openLink: { url: handleUrl } },
                        },
                        {
                          text: "他の人に依頼",
                          color: { red: 0.6, green: 0.6, blue: 0.6, alpha: 1 },
                          onClick: { openLink: { url: delegateUrl } },
                        },
                      ],
                    },
                  }],
                },
              ],
            },
          }],
        };
        await fetch(staffWebhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(personalCard),
        }).catch(err => console.error("Staff webhook error:", err));
      }
    }

    // 監査ログ：来訪チェックイン
    try {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || null);
      await sb.from("reception_audit_logs").insert({
        action:     isDelivery ? "delivery_checkin" : "visit_checkin",
        table_name: "reception_visits",
        record_id:  visitId || null,
        new_data:   { visitorName, company, host, room, time, count, purpose, isDelivery: !!isDelivery },
        ip_address: ip,
        user_agent: req.headers["user-agent"] || null,
      });
    } catch (e) { console.error("audit checkin error:", e); }

    return res.json({ ok: true });
  } catch (err) {
    console.error("notify error:", err);
    return res.status(500).json({ error: err.message });
  }
};
