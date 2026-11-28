import { NextRequest } from "next/server";
import { fail, isHttpUrl, supabase, telegramUser } from "@/lib/server";
import { randomBytes } from "node:crypto";

export async function GET(request: NextRequest) {
  try {
    const user = telegramUser(request);
    const db = supabase();
    const { data: memberships, error: membershipsError } = await db
      .from("santa_participants")
      .select("room_id, role")
      .eq("telegram_id", user.id);
    if (membershipsError) throw membershipsError;
    if (!memberships?.length) return Response.json({ rooms: [] });

    const { data: rooms, error: roomsError } = await db
      .from("santa_rooms")
      .select("id, name, gift_budget, budget_unlimited, draw_at, status, invite_code")
      .in("id", memberships.map(membership => membership.room_id));
    if (roomsError) throw roomsError;

    const roles = new Map(memberships.map(membership => [membership.room_id, membership.role]));
    return Response.json({ rooms: (rooms ?? []).map(room => ({ ...room, role: roles.get(room.id) })) });
  } catch (error) {
    console.error("[santa] Failed to load rooms", error);
    return fail(error, 401);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = telegramUser(request); const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    if (fullName.split(/\s+/).length < 2) return fail(new Error("Укажите имя и фамилию"));
    const wishInput = body.wishlist;
    if (wishInput) {
      const sourceUrl = String(wishInput.source_url ?? "").trim();
      if (wishInput.wishlist_mode === "link" && sourceUrl && !isHttpUrl(sourceUrl)) return fail(new Error("Укажите полный адрес ссылки, начиная с https://"));
      const items = Array.isArray(wishInput.wishes) ? wishInput.wishes : [];
      if (items.some((item: any) => {
        const url = String(item.product_url ?? "").trim();
        return url && !isHttpUrl(url);
      })) return fail(new Error("Ссылка на товар должна быть полным адресом с https://"));
    }
    const db = supabase(); const inviteCode = randomBytes(8).toString("base64url");
    const { data: roomId, error } = await db.rpc("create_santa_room", {
      p_name: String(body.name ?? "").trim().slice(0, 70), p_creator_id: user.id, p_invite_code: inviteCode,
      p_gift_budget: Math.max(0, Number(body.budget) || 0), p_draw_at: body.drawAt || null, p_full_name: fullName,
    });
    if (error) throw error;
    const { error: budgetError } = await db.from("santa_rooms").update({ budget_unlimited: Boolean(body.budgetUnlimited) }).eq("id", roomId);
    if (budgetError) throw budgetError;
    const { data: avatarId, error: avatarError } = await db.rpc("assign_santa_avatar", { p_room_id: roomId, p_telegram_id: user.id, p_current: Number(body.avatarId) || null });
    if (avatarError) throw avatarError;
    if (body.wishlist) {
      const wish = body.wishlist;
      const mode = wish.wishlist_mode === "link" ? "link" : "list";
      const sourceUrl = String(wish.source_url ?? "").trim();
      if (mode === "link" && sourceUrl && !isHttpUrl(sourceUrl)) return fail(new Error("Укажите полный адрес ссылки, начиная с https://"));
      const { error: wishlistError } = await db.from("santa_wishlists").upsert({ room_id: roomId, telegram_id: user.id, wishlist_mode: mode, source_url: mode === "link" ? sourceUrl || null : null }, { onConflict: "room_id,telegram_id" });
      if (wishlistError) throw wishlistError;
      const items = (Array.isArray(wish.wishes) ? wish.wishes : []).map((item: any, position: number) => ({ room_id: roomId, telegram_id: user.id, title: String(item.title ?? "").trim(), description: String(item.description ?? "").trim() || null, product_url: String(item.product_url ?? "").trim() || null, price: item.price ? Number(item.price) : null, position })).filter((item: any) => item.title).slice(0, 30);
      if (items.length) { const { error: itemsError } = await db.from("santa_wishes").insert(items); if (itemsError) throw itemsError; }
    }
    const { data: room, error: roomError } = await db.from("santa_rooms").select("id, name, gift_budget, budget_unlimited, draw_at, status, invite_code").eq("id", roomId).single();
    if (roomError) throw roomError;
    return Response.json({ room, avatarId }, { status: 201 });
  } catch (error) { return fail(error); }
}

