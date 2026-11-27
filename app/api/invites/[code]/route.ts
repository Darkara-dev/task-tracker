import { NextRequest } from "next/server";
import { fail, supabase, telegramUser } from "@/lib/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const user = telegramUser(request); const { code } = await params; const db = supabase();
    const { data: room, error } = await db.from("santa_rooms").select("id, name, gift_budget, budget_unlimited, draw_at, status, invite_code, created_by").eq("invite_code", code).maybeSingle();
    if (error) throw error;
    if (!room) return Response.json({ error: "ROOM_NOT_FOUND", code: "ROOM_NOT_FOUND" }, { status: 404 });
    const [{ data: organizer }, { data: participant }, { count }] = await Promise.all([
      db.from("santa_participants").select("full_name, avatar_id").eq("room_id", room.id).eq("telegram_id", room.created_by).maybeSingle(),
      db.from("santa_participants").select("telegram_id").eq("room_id", room.id).eq("telegram_id", user.id).maybeSingle(),
      db.from("santa_participants").select("id", { count: "exact", head: true }).eq("room_id", room.id),
    ]);
    if (!participant && room.status !== "open") return Response.json({ error: "DRAW_DONE", code: "DRAW_DONE" }, { status: 409 });
    if (!participant && (count ?? 0) >= 32) return Response.json({ error: "ROOM_FULL", code: "ROOM_FULL" }, { status: 409 });
    return Response.json({ room, organizer, alreadyMember: Boolean(participant) });
  } catch (error) { return fail(error); }
}
