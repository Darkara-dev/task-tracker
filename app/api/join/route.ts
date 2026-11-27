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
    if (body.wishlist) {
      const wish = body.wishlist;
      const mode = wish.wishlist_mode === "link" ? "link" : "list";
      const sourceUrl = String(wish.source_url ?? "").trim();
      if (mode === "link" && sourceUrl && !/^https?:\/\//i.test(sourceUrl)) return fail(new Error("Ссылка должна начинаться с https://"));
      const { error: wishlistError } = await db.from("santa_wishlists").upsert({ room_id: roomId, telegram_id: user.id, wishlist_mode: mode, source_url: mode === "link" ? sourceUrl || null : null }, { onConflict: "room_id,telegram_id" });
      if (wishlistError) throw wishlistError;
      const items = (Array.isArray(wish.wishes) ? wish.wishes : []).map((item: any, position: number) => ({ room_id: roomId, telegram_id: user.id, title: String(item.title ?? "").trim(), description: String(item.description ?? "").trim() || null, product_url: String(item.product_url ?? "").trim() || null, price: item.price ? Number(item.price) : null, position })).filter((item: any) => item.title).slice(0, 30);
      if (items.length) { const { error: itemsError } = await db.from("santa_wishes").insert(items); if (itemsError) throw itemsError; }
    }
    return Response.json({ roomId, avatarId });
  } catch (error) { return fail(error); }
}
