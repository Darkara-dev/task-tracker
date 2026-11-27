import { NextRequest } from "next/server";
import { fail, supabase, telegramUser } from "@/lib/server";
import { randomBytes } from "node:crypto";

export async function GET(request: NextRequest) {
  try {
    const user = telegramUser(request); const db = supabase();
    const { data, error } = await db.from("santa_participants").select("room_id, role, santa_rooms(id, name, gift_budget, budget_unlimited, draw_at, status, invite_code)").eq("telegram_id", user.id);
    if (error) throw error;
    return Response.json({ rooms: (data ?? []).map((entry: any) => ({ ...entry.santa_rooms, role: entry.role })) });
  } catch (error) { return fail(error, 401); }
}

export async function POST(request: NextRequest) {
  try {
    const user = telegramUser(request); const body = await request.json();
    const fullName = String(body.fullName ?? "").trim();
    if (fullName.split(/\s+/).length < 2) return fail(new Error("Укажите имя и фамилию"));
    const db = supabase(); const inviteCode = randomBytes(8).toString("base64url");
    const { data: roomId, error } = await db.rpc("create_santa_room", {
      p_name: String(body.name ?? "").trim().slice(0, 70), p_creator_id: user.id, p_invite_code: inviteCode,
      p_gift_budget: Math.max(0, Number(body.budget) || 0), p_draw_at: body.drawAt || null, p_full_name: fullName,
    });
    if (error) throw error;
    const { error: budgetError } = await db.from("santa_rooms").update({ budget_unlimited: Boolean(body.budgetUnlimited) }).eq("id", roomId);
    if (budgetError) throw budgetError;
    const { data: avatarId, error: avatarError } = await db.rpc("assign_santa_avatar", { p_room_id: roomId, p_telegram_id: user.id });
    if (avatarError) throw avatarError;
    if (body.wishlist) {
      const wish = body.wishlist;
      const { error: wishlistError } = await db.from("santa_wishlists").upsert({ room_id: roomId, telegram_id: user.id, wishlist_mode: wish.wishlist_mode === "link" ? "link" : "list", source_url: wish.source_url || null }, { onConflict: "room_id,telegram_id" });
      if (wishlistError) throw wishlistError;
    }
    const { data: room, error: roomError } = await db.from("santa_rooms").select("id, name, gift_budget, budget_unlimited, draw_at, status, invite_code").eq("id", roomId).single();
    if (roomError) throw roomError;
    return Response.json({ room, avatarId }, { status: 201 });
  } catch (error) { return fail(error); }
}

