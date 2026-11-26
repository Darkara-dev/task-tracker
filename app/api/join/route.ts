import { NextRequest } from "next/server";
import { fail, supabase, telegramUser } from "@/lib/server";

export async function POST(request: NextRequest) {
  try {
    const user = telegramUser(request); const body = await request.json(); const code = String(body.code ?? "");
    const fullName = String(body.fullName ?? "").trim();
    if (fullName.split(/\s+/).length < 2) return fail(new Error("Укажите имя и фамилию"));
    const db = supabase();
    const { data: roomId, error } = await db.rpc("join_santa_room", { p_invite_code: code, p_telegram_id: user.id, p_full_name: fullName });
    if (error) throw error;
    return Response.json({ roomId });
  } catch (error) { return fail(error); }
}

