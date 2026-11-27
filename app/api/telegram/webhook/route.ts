import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://task-tracker-darkara.vercel.app";
const WELCOME_TEXT =
  "🎅 Привет! Здесь можно устроить Тайного Санту: создай комнату или присоединись к игре по ссылке, заполни вишлист и узнай, кому готовить подарок.\n\nНажми кнопку ниже, чтобы начать 🎁";

export async function POST(request: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return Response.json({ error: "Telegram bot is not configured" }, { status: 503 });

  const expected = createHash("sha256").update(token).digest();
  const suppliedHeader = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const supplied = Buffer.from(suppliedHeader, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: "Invalid update" }, { status: 400 });
  }

  const message = update.message;
  const text = message?.text ?? "";
  const chatId = message?.chat?.id;
  if (!chatId || !/^\/start(?:@\w+)?(?:\s|$)/.test(text)) {
    return Response.json({ ok: true });
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: WELCOME_TEXT,
      reply_markup: {
        inline_keyboard: [[{ text: "Открыть игру", web_app: { url: APP_URL } }]],
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    console.error("Telegram welcome message failed", response.status);
    return Response.json({ error: "Telegram could not send the welcome message" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
