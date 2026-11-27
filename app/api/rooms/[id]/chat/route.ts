import { NextRequest } from "next/server";
import { fail, sendTelegramNotification, supabase, telegramUser } from "@/lib/server";

type Context = { params: Promise<{ id: string }> };
type Tab = "recipient" | "santa";

async function getThread(db: ReturnType<typeof supabase>, roomId: string, userId: number, tab: Tab) {
  const query = tab === "recipient"
    ? db.from("santa_assignments").select("recipient_id").eq("room_id", roomId).eq("giver_id", userId)
    : db.from("santa_assignments").select("giver_id").eq("room_id", roomId).eq("recipient_id", userId);
  const { data: assignment, error } = await query.maybeSingle();
  if (error) throw error;
  const otherId = tab === "recipient" ? assignment?.recipient_id : assignment?.giver_id;
  return otherId ? Number(otherId) : null;
}

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const user = telegramUser(request); const { id } = await params; const tab: Tab = request.nextUrl.searchParams.get("tab") === "santa" ? "santa" : "recipient"; const db = supabase();
    const [{ data: member }, { data: room }] = await Promise.all([
      db.from("santa_participants").select("telegram_id").eq("room_id", id).eq("telegram_id", user.id).maybeSingle(),
      db.from("santa_rooms").select("status").eq("id", id).maybeSingle(),
    ]);
    if (!member) return fail(new Error("Вы не состоите в этой комнате"), 403);
    if (room?.status !== "drawn") return fail(new Error("Чат откроется после жеребьёвки"), 409);
    const otherId = await getThread(db, id, user.id, tab);
    if (!otherId) return fail(new Error("Для вас пока не найден собеседник"), 404);
    const first = Math.min(user.id, otherId), second = Math.max(user.id, otherId);
    const { data, error } = await db.from("santa_messages")
      .select("id, sender_id, recipient_id, body, created_at")
      .eq("room_id", id)
      .or(`and(sender_id.eq.${first},recipient_id.eq.${second}),and(sender_id.eq.${second},recipient_id.eq.${first})`)
      .order("created_at", { ascending: true }).limit(200);
    if (error) throw error;
    return Response.json({ messages: (data ?? []).map(message => ({ id: message.id, body: message.body, created_at: message.created_at, mine: Number(message.sender_id) === user.id })) });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const user = telegramUser(request); const { id } = await params; const body = await request.json(); const tab: Tab = body.tab === "santa" ? "santa" : "recipient"; const text = String(body.text ?? "").trim();
    if (!text || text.length > 1200) return fail(new Error("Сообщение должно быть от 1 до 1 200 символов"));
    const db = supabase();
    const [{ data: room }, { data: member }] = await Promise.all([
      db.from("santa_rooms").select("status, name, invite_code").eq("id", id).maybeSingle(),
      db.from("santa_participants").select("telegram_id").eq("room_id", id).eq("telegram_id", user.id).maybeSingle(),
    ]);
    if (!member) return fail(new Error("Вы не состоите в этой комнате"), 403);
    if (room?.status !== "drawn") return fail(new Error("Чат откроется после жеребьёвки"), 409);
    const otherId = await getThread(db, id, user.id, tab);
    if (!otherId) return fail(new Error("Для вас пока не найден собеседник"), 404);
    const { data: saved, error } = await db.from("santa_messages").insert({ room_id: id, sender_id: user.id, recipient_id: otherId, body: text }).select("id, body, created_at").single();
    if (error) throw error;
    const { data: counterpart } = await db.from("santa_participants").select("telegram_id").eq("room_id", id).eq("telegram_id", otherId).single();
    const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (counterpart && bot && room) {
      const targetTab = tab === "recipient" ? "santa" : "recipient";
      const appUrl = `https://t.me/${bot}?startapp=room_${room.invite_code}_chat_${targetTab}`;
      await sendTelegramNotification(Number(counterpart.telegram_id), `Вам пришёл анонимный вопрос в комнате «${room.name}». Откройте приложение, чтобы ответить.`, appUrl);
    }
    return Response.json({ message: { id: saved.id, body: saved.body, created_at: saved.created_at, mine: true } }, { status: 201 });
  } catch (error) { return fail(error); }
}
