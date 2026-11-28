import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };

export function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase ещё не подключён");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function telegramUser(request: NextRequest): TelegramUser {
  const initData = request.headers.get("x-telegram-init-data");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!initData || !token) throw new Error("Откройте приложение через Telegram");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("Не удалось подтвердить Telegram");
  params.delete("hash");
  const fields = [...params.entries()];
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  let provided: Buffer;
  try { provided = Buffer.from(hash, "hex"); } catch { throw new Error("Некорректная подпись Telegram"); }
  const checkSignatures = [
    fields.filter(([key]) => key !== "signature"),
    fields,
  ];
  const valid = checkSignatures.some(entries => {
    const check = entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join("\n");
    const expected = createHmac("sha256", secret).update(check).digest();
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  });
  if (!valid) throw new Error("Подпись Telegram недействительна");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86_400) throw new Error("Сеанс Telegram истёк. Переоткройте приложение.");
  const rawUser = params.get("user");
  if (!rawUser) throw new Error("Telegram не передал профиль пользователя");
  return JSON.parse(rawUser) as TelegramUser;
}

export function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Что-то пошло не так";
  return Response.json({ error: message }, { status });
}



export async function sendTelegramNotification(chatId: number, text: string, appUrl: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        reply_markup: { inline_keyboard: [[{ text: "Открыть приложение", url: appUrl }]] },
      }),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}
