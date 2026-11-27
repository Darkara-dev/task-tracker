import { NextRequest } from "next/server";
import { fail, supabase, telegramUser } from "@/lib/server";

export async function POST(request: NextRequest) {
  try {
    const user = telegramUser(request); const body = await request.json(); const code = String(body.code ?? "").trim();
    const fullName = String(body.fullName ?? "").trim();
    if (!code) return Response.json({ error: "Не похоже на ссылку-приглашение", code: "ROOM_NOT_FOUND" }, { status: 404 });
    if (fullName.split(/\s+/).length < 2) return fail(new Error("Укажите имя и фамилию"));
    const db = supabase();
    const { data: roomId, error } = await db.rpc("join_santa_room", { p_invite_code: code, p_telegram_id: user.id, p_full_name: fullName });
    if (error) {
      const message = error.message ?? "Не удалось присоединиться";
      const code = ["ROOM_NOT_FOUND", "DRAW_DONE", "ROOM_FULL"].find(value => message.includes(value));
      if (code) return Response.json({ error: code, code }, { status: code === "ROOM_NOT_FOUND" ? 404 : 409 });
      throw error;
    }
    const { data: avatarId, error: avatarError } = await db.rpc("assign_santa_avatar", { p_room_id: roomId, p_telegram_id: user.id, p_current: Number(body.avatarId) || null });
    if (avatarError) {
      if ((avatarError.message ?? "").includes("ROOM_FULL")) return Response.json({ error: "ROOM_FULL", code: "ROOM_FULL" }, { status: 409 });
      throw avatarError;
    }
    return Response.json({ roomId, avatarId });
  } catch (error) { return fail(error); }
}
