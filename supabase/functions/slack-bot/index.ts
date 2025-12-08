// ==========================================
// Slack Bot - 複数チャンネル対応版
// ==========================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { WebClient } from "https://esm.sh/@slack/web-api@6.11.2";

const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;

// ★重要: カンマ区切りの文字列を配列に変換して保持します
const ALLOWED_CHANNELS_RAW = Deno.env.get("ALLOWED_CHANNEL_ID") || "";
const ALLOWED_CHANNELS = ALLOWED_CHANNELS_RAW.split(",").map(id => id.trim()).filter(id => id.length > 0);

const slack = new WebClient(SLACK_BOT_TOKEN);

console.log(`Bot started. Allowed Channels: ${ALLOWED_CHANNELS.join(", ")}`);

serve(async (req) => {
  try {
    const body = await req.json();

    // URL Verification
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // イベント処理
    if (body.event && body.event.type === "app_mention" && !body.event.bot_id) {
      
      const incomingChannel = body.event.channel;

      // ★重要: リストの中に、今回のチャンネルが含まれているかチェック
      if (ALLOWED_CHANNELS.length > 0 && !ALLOWED_CHANNELS.includes(incomingChannel)) {
        console.log(`Skip: Channel ${incomingChannel} is not in the allowed list.`);
        return new Response("OK");
      }

      console.log(`Processing in allowed channel: ${incomingChannel}`);
      const userQuestion = body.event.text;

      const backgroundTask = async () => {
        try {
          // 履歴取得
          const history = await slack.conversations.history({ channel: incomingChannel, limit: 10 });
          const contextText = (history.messages || []).reverse()
            .map((m: any) => `${m.bot_id ? "Model" : "User"}: ${m.text}`).join("\n");

          // Gemini API呼び出し (モデル名は gemini-1.5-flash 固定)
          const MODEL_NAME = "gemini-2.5-flash";
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${GEMINI_API_KEY}`;

          const response = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `
あなたはアシスタントです。以下の履歴を元に質問に答えてください。
[履歴]
${contextText}
[質問]
${userQuestion}
` }] }]
            })
          });

          if (!response.ok) {
             const txt = await response.text();
             throw new Error(`Gemini API Error: ${txt}`);
          }

          const data = await response.json();
          const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "回答生成エラー";

          // Slackへ返信
          await slack.chat.postMessage({ channel: incomingChannel, text: answer });

        } catch (err) {
          console.error("Error:", err);
          await slack.chat.postMessage({ channel: incomingChannel, text: "エラー: " + err });
        }
      };

      if (typeof EdgeRuntime !== "undefined") { EdgeRuntime.waitUntil(backgroundTask()); } else { await backgroundTask(); }
    }
    return new Response("OK", { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
