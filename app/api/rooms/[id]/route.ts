import { NextRequest } from "next/server";
import { fail, sendTelegramNotification, supabase, telegramUser } from "@/lib/server";

type WishInput = { title?: string; description?: string; product_url?: string; price?: string | number };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = telegramUser(request); const { id } = await params; const db = supabase();
    const { data: member, error: memberError } = await db.from("santa_participants").select("role").eq("room_id", id).eq("telegram_id", user.id).single();
    if (memberError || !member) return fail(new Error("Вы не состоите в этой комнате"), 403);
    const { data: room, error } = await db.from("santa_rooms").select("id, name, gift_budget, budget_unlimited, draw_at, status, invite_code").eq("id", id).single();
    if (error) throw error;
    const { data: players, error: playersError } = await db.from("santa_participants").select("telegram_id, full_name, role, avatar_id").eq("room_id", id).order("created_at");
    if (playersError) throw playersError;
    const [{ data: wishlistRow, error: wishError }, { data: wishes, error: wishesError }] = await Promise.all([
      db.from("santa_wishlists").select("source_url, wishlist_mode, title, description, color, size, notes, product_url, price").eq("room_id", id).eq("telegram_id", user.id).maybeSingle(),
      db.from("santa_wishes").select("id, title, description, product_url, price, position").eq("room_id", id).eq("telegram_id", user.id).order("position"),
    ]);
    if (wishError) throw wishError;
    if (wishesError) throw wishesError;
    const wishlist = wishlistRow ? { ...wishlistRow, wishes: wishes ?? [] } : { wishlist_mode: "list", wishes: wishes ?? [] };
    let recipient = null;
    if (room.status === "drawn") {
      const { data: assignment } = await db.from("santa_assignments").select("recipient_id").eq("room_id", id).eq("giver_id", user.id).maybeSingle();
      if (assignment) {
        const [{ data: person }, { data: recipientWishlist }, { data: recipientWishes }] = await Promise.all([
          db.from("santa_participants").select("full_name, avatar_id").eq("room_id", id).eq("telegram_id", assignment.recipient_id).single(),
          db.from("santa_wishlists").select("source_url, wishlist_mode, title, description, color, size, notes, product_url, price").eq("room_id", id).eq("telegram_id", assignment.recipient_id).maybeSingle(),
          db.from("santa_wishes").select("id, title, description, product_url, price, position").eq("room_id", id).eq("telegram_id", assignment.recipient_id).order("position"),
        ]);
        recipient = person ? { ...person, wishlist: recipientWishlist ? { ...recipientWishlist, wishes: recipientWishes ?? [] } : { wishlist_mode: "list", wishes: recipientWishes ?? [] } } : null;
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
      const mode = wish.wishlist_mode === "link" ? "link" : "list";
      const wishlistUrl = String(wish.source_url ?? "").trim();
      if (mode === "link" && wishlistUrl && !/^https?:\/\//i.test(wishlistUrl)) return fail(new Error("Ссылка должна начинаться с https://"));
      const { error } = await db.from("santa_wishlists").upsert({
        room_id: id, telegram_id: user.id, wishlist_mode: mode,
        source_url: mode === "link" ? wishlistUrl || null : null,
        title: wish.title || null, description: wish.description || null,
        color: wish.color || null, size: wish.size || null, notes: wish.notes || null,
        product_url: wish.product_url || null, price: wish.price || null,
      }, { onConflict: "room_id,telegram_id" });
      if (error) throw error;
      const items: WishInput[] = Array.isArray(wish.wishes) ? wish.wishes : [];
      const { error: deleteError } = await db.from("santa_wishes").delete().eq("room_id", id).eq("telegram_id", user.id);
      if (deleteError) throw deleteError;
      const clean = items.map((item, position) => ({ room_id: id, telegram_id: user.id, title: String(item.title ?? "").trim(), description: String(item.description ?? "").trim() || null, product_url: String(item.product_url ?? "").trim() || null, price: item.price ? Number(item.price) : null, position })).filter(item => item.title).slice(0, 30);
      if (clean.length) { const { error: insertError } = await db.from("santa_wishes").insert(clean); if (insertError) throw insertError; }
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
      const [{ data: room }, { data: members }] = await Promise.all([
        db.from("santa_rooms").select("name, invite_code").eq("id", id).single(),
        db.from("santa_participants").select("telegram_id").eq("room_id", id),
      ]);
      const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
      if (room && bot) await Promise.all((members ?? []).map((person: { telegram_id: number }) =>
        sendTelegramNotification(person.telegram_id, "Ваш Тайный Санта определён. Откройте приложение, чтобы узнать результат.", `https://t.me/${bot}?startapp=room_${room.invite_code}_result`)
      ));
      return Response.json({ ok: true, count: data });
    }
    return fail(new Error("Неизвестное действие"));
  } catch (error) { return fail(error); }
}
