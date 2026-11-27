import { NextRequest } from "next/server";
import { fail, supabase, telegramUser } from "@/lib/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = telegramUser(request); const { id } = await params; const db = supabase();
    const { data: member, error: memberError } = await db.from("santa_participants").select("role").eq("room_id", id).eq("telegram_id", user.id).single();
    if (memberError || !member) return fail(new Error("Вы не состоите в этой комнате"), 403);
    const { data: room, error } = await db.from("santa_rooms").select("id, name, gift_budget, draw_at, status, invite_code").eq("id", id).single();
    if (error) throw error;
    const { data: players, error: playersError } = await db.from("santa_participants").select("telegram_id, full_name, role").eq("room_id", id).order("created_at");
    if (playersError) throw playersError;
    const { data: wishlist, error: wishError } = await db.from("santa_wishlists").select("id, source_url, title, description, color, size, notes, product_url, price").eq("room_id", id).eq("telegram_id", user.id).maybeSingle();
    if (wishError) throw wishError;
    let recipient = null;
    if (room.status === "drawn") {
      const { data: assignment } = await db.from("santa_assignments").select("recipient_id").eq("room_id", id).eq("giver_id", user.id).maybeSingle();
      if (assignment) {
        const { data: person } = await db.from("santa_participants").select("full_name").eq("room_id", id).eq("telegram_id", assignment.recipient_id).single();
        const { data: recipientWishlist } = await db.from("santa_wishlists").select("source_url, title, description, color, size, notes, product_url, price").eq("room_id", id).eq("telegram_id", assignment.recipient_id).maybeSingle();
        recipient = person ? { ...person, wishlist: recipientWishlist } : null;
      }
    }
    let exclusions: Array<[number, number]> = [];
    if (member.role === "admin") {
      const { data } = await db.from("santa_exclusions").select("first_id, second_id").eq("room_id", id);
      exclusions = (data ?? []).map((row: any) => [row.first_id, row.second_id]);
    }
    return Response.json({ room, players, wishlist, recipient, exclusions, role: member.role });
  } catch (error) { return fail(error, 401); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = telegramUser(request); const { id } = await params; const body = await request.json(); const db = supabase();
    const { data: member, error: memberError } = await db.from("santa_participants").select("role").eq("room_id", id).eq("telegram_id", user.id).single();
    if (memberError || !member) return fail(new Error("Нет доступа к комнате"), 403);
    if (body.action === "wishlist") {
      const wish = body.wishlist ?? {};
      const { error } = await db.from("santa_wishlists").upsert({
        room_id: id, telegram_id: user.id,
        source_url: wish.source_url || null, title: wish.title || null,
        description: wish.description || null, color: wish.color || null,
        size: wish.size || null, notes: wish.notes || null,
        product_url: wish.product_url || null, price: wish.price || null,
      }, { onConflict: "room_id,telegram_id" });
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (member.role !== "admin") return fail(new Error("Это действие доступно только организатору"), 403);
    if (body.action === "exclusions") {
      const { error } = await db.rpc("set_santa_exclusions", { p_room_id: id, p_admin_id: user.id, p_pairs: body.pairs ?? [] });
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (body.action === "draw") {
      const { data, error } = await db.rpc("draw_secret_santa", { p_room_id: id, p_admin_id: user.id });
      if (error) throw error;
      return Response.json({ ok: true, count: data });
    }
    return fail(new Error("Неизвестное действие"));
  } catch (error) { return fail(error); }
}

