"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

declare global { interface Window { Telegram?: { WebApp?: { initData: string; initDataUnsafe?: { user?: { id?: number; first_name?: string; last_name?: string; username?: string }; start_param?: string }; ready: () => void; expand: () => void; setHeaderColor?: (color: string) => void; setBackgroundColor?: (color: string) => void } } } }

type Room = { id: string; name: string; gift_budget: number; budget_unlimited?: boolean; draw_at?: string; status: string; invite_code: string; role?: string };
type Player = { telegram_id: number; full_name: string; role: string; avatar_id?: number };
type Wish = { id?: string; title: string; description?: string; product_url?: string; price?: string | number; position?: number };
type Wishlist = { wishlist_mode?: "list" | "link"; source_url?: string; wishes?: Wish[]; title?: string; description?: string; color?: string; size?: string; notes?: string; product_url?: string; price?: string };
type RoomData = { room: Room; players: Player[]; wishlist?: Wishlist; recipient?: { full_name: string; avatar_id?: number; wishlist?: Wishlist } | null; exclusions: Array<[number, number]>; role: string };

const demoRoom: Room = { id: "demo", name: "Новогоднее чудо", gift_budget: 2500, draw_at: "2026-12-15", status: "open", invite_code: "sneg-2026", role: "admin" };
const demoPlayers = ["Аня Лебедева", "Миша Котов", "Саша Орлова", "Дима Волков"].map((full_name, i) => ({ telegram_id: i + 1, full_name, role: i === 0 ? "admin" : "player" }));
const tg = () => window.Telegram?.WebApp;

export default function Home() {
  const [initData, setInitData] = useState("");
  const [userName, setUserName] = useState("Санта");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [active, setActive] = useState<RoomData | null>(null);
  const [screen, setScreen] = useState<"home" | "room" | "wishlist" | "admin" | "create" | "join" | "wait" | "result" | "chat" | "closed">("home");
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [demo, setDemo] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [createStep, setCreateStep] = useState(1);
  const [createDraft, setCreateDraft] = useState({ name: "", budget: "", drawAt: "", unlimited: false });
  const [chatTab, setChatTab] = useState<"recipient" | "santa">("recipient");
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; body: string; created_at: string; mine: boolean }>>([]);
  const [chatText, setChatText] = useState("");
  const [showRecipient, setShowRecipient] = useState(false);
  const [wishlistMode, setWishlistMode] = useState<"list" | "link">("list");
  const [wishlistUrl, setWishlistUrl] = useState("");
  const [wishItems, setWishItems] = useState<Wish[]>([]);
  const [wishDraft, setWishDraft] = useState<Wish>({ title: "", description: "", product_url: "", price: "" });
  const [editingWish, setEditingWish] = useState<number | null>(null);

  useEffect(() => {
    const app = tg();
    app?.ready(); app?.expand(); app?.setHeaderColor?.("#0F3D2E"); app?.setBackgroundColor?.("#0F3D2E");
    setInitData(app?.initData ?? "");
    const name = [app?.initDataUnsafe?.user?.first_name, app?.initDataUnsafe?.user?.last_name].filter(Boolean).join(" ");
    if (name) setUserName(name);
    if (app?.initData) { setDemo(false); void Promise.all([loadRooms(app.initData), new Promise(resolve => window.setTimeout(resolve, 1800))]).finally(() => setBooting(false)); } else { window.setTimeout(() => setBooting(false), 1800); }
    const start = app?.initDataUnsafe?.start_param ?? "";
    if (start.startsWith("join-")) { setJoinCode(start.slice(5)); setScreen("join"); }
  }, []);

  async function loadRooms(auth = initData) {
    try { const res = await fetch("/api/rooms", { headers: { "x-telegram-init-data": auth } }); const json = await res.json(); if (res.ok) setRooms(json.rooms ?? []); }
    catch { setNotice("Не удалось загрузить комнаты"); }
  }
  async function openRoom(room: Room) {
    if (demo || room.id === "demo") {
      setActive({ room, players: demoPlayers, role: "admin", exclusions: [[2, 3]], wishlist: { title: "Идеи к празднику", notes: "Люблю книги и уютные вещи" } }); setScreen("room"); return;
    }
    setBusy(true);
    try { const res = await fetch(`/api/rooms/${room.id}`, { headers: { "x-telegram-init-data": initData } }); const json = await res.json(); if (!res.ok) throw new Error(json.error); setActive(json); setScreen("room"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось открыть комнату"); }
    finally { setBusy(false); }
  }
  const allRooms = useMemo(() => demo ? [demoRoom, ...rooms.filter(r => r.id !== "demo")] : rooms, [demo, rooms]);

  function openWishlist() {
    const wishlist = active?.wishlist;
    setWishlistMode(wishlist?.wishlist_mode ?? "list");\n    setWishlistUrl(wishlist?.source_url ?? "");
    const items = wishlist?.wishes?.length ? wishlist.wishes : wishlist?.title ? [{ title: wishlist.title, description: [wishlist.description, wishlist.color && `Цвет: ${wishlist.color}`, wishlist.size && `Размер: ${wishlist.size}`, wishlist.notes].filter(Boolean).join(". "), product_url: wishlist.product_url, price: wishlist.price }] : [];
    setWishItems(items); setWishDraft({ title: "", description: "", product_url: "", price: "" }); setEditingWish(null); setScreen("wishlist");
  }

  function saveWishDraft() {
    if (!wishDraft.title?.trim()) { setNotice("Напишите, что подарить"); return; }
    setWishItems(items => {
      if (editingWish === null) return [...items, { ...wishDraft, title: wishDraft.title.trim() }];
      return items.map((item, index) => index === editingWish ? { ...wishDraft, title: wishDraft.title.trim() } : item);
    });
    setWishDraft({ title: "", description: "", product_url: "", price: "" }); setEditingWish(null); setNotice("Пожелание добавлено");
  }

  async function loadChat(tab: "recipient" | "santa" = chatTab) {
    if (!active || demo || active.room.id.startsWith("demo")) { setChatMessages([]); return; }
    try {
      const res = await fetch(`/api/rooms/${active.room.id}/chat?tab=${tab}`, { headers: { "x-telegram-init-data": initData } });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setChatMessages(json.messages ?? []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось загрузить сообщения"); }
  }

  async function sendChat() {
    const text = chatText.trim(); if (!active || !text || busy) return;
    if (demo) { setNotice("Анонимный чат станет доступен после жеребьёвки"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/rooms/${active.room.id}/chat`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ tab: chatTab, text }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error);
      setChatMessages(prev => [...prev, json.message]); setChatText("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось отправить сообщение"); }
    finally { setBusy(false); }
  }

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true);
    if (demo) {
      const room: Room = { ...demoRoom, id: `demo-${Date.now()}`, name: String(form.get("name")), gift_budget: Number(form.get("budget")) || 0, budget_unlimited: createDraft.unlimited, invite_code: Math.random().toString(36).slice(2, 10) };
      setRooms(prev => [room, ...prev]); setActive({ room, players: demoPlayers, role: "admin", exclusions: [] }); setNotice("Комната создана! Позовите друзей"); setScreen("room"); setCreateStep(1); setBusy(false); return;
    }
    try {
      const res = await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ name: form.get("name"), budget: form.get("budget"), budgetUnlimited: createDraft.unlimited, drawAt: form.get("drawAt"), fullName: form.get("fullName") }) });
      const json = await res.json(); if (!res.ok) throw new Error(json.error);
      await loadRooms();
      const detail = await fetch(`/api/rooms/${json.room.id}`, { headers: { "x-telegram-init-data": initData } }); const data = await detail.json(); if (!detail.ok) throw new Error(data.error);
      setActive(data); setScreen("room"); setCreateStep(1); setNotice("Комната создана! Позовите друзей");
    }
    catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось создать комнату"); }
    finally { setBusy(false); }
  }
  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fullName = String(new FormData(event.currentTarget).get("fullName") ?? "");
    if (demo) { setNotice("Приглашения заработают после подключения бота"); return; }
    setBusy(true);
    try { const res = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ code: joinCode, fullName }) }); const json = await res.json(); if (!res.ok) throw new Error(json.code === "ROOM_FULL" ? "В комнате уже 32 участника" : json.code === "DRAW_DONE" ? "Игра уже началась" : json.code === "ROOM_NOT_FOUND" ? "Ссылка не работает" : json.error); await loadRooms(); const detail = await fetch(`/api/rooms/${json.roomId}`, { headers: { "x-telegram-init-data": initData } }); const data = await detail.json(); if (!detail.ok) throw new Error(data.error); setActive(data); setNotice("Вы в игре! Ждём жеребьёвку"); setScreen("room"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось присоединиться"); }
    finally { setBusy(false); }
  }
  function inviteLink(room: Room) { const username = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME; return username ? `https://t.me/${username}?startapp=join-${room.invite_code}` : `Код приглашения: ${room.invite_code}`; }
  async function copyInvite(room: Room) {
    const budget = room.budget_unlimited || !room.gift_budget ? "без ограничений" : `до ${room.gift_budget.toLocaleString("ru-RU")} ₽`;
    const text = `🎅 Привет! Зову тебя в Тайного Санту «${room.name}».\\nБюджет подарка: ${budget}.\\nЖми на ссылку, заполни вишлист и жди, кому достанется твоё имя 🎁\\n${inviteLink(room)}`;
    try { await navigator.clipboard.writeText(text); } catch { const input = document.createElement("textarea"); input.value = text; document.body.append(input); input.select(); const copied = document.execCommand("copy"); input.remove(); if (!copied) (tg() as any)?.openTelegramLink?.(`https://t.me/share/url?url=${encodeURIComponent(inviteLink(room))}&text=${encodeURIComponent(text)}`); }
    (tg() as any)?.HapticFeedback?.notificationOccurred?.("success"); setNotice("Приглашение скопировано. Отправьте его друзьям");
  }
  async function saveWishlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!active) return;
    const form = new FormData(event.currentTarget); const wishlist: Wishlist = { wishlist_mode: wishlistMode, source_url: wishlistUrl.trim(), wishes: wishItems };
    if (demo || active.room.id.startsWith("demo")) { setActive({ ...active, wishlist }); setNotice("Вишлист сохранён в предпросмотре"); setScreen("room"); return; }
    setBusy(true);
    try { const res = await fetch(`/api/rooms/${active.room.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ action: "wishlist", wishlist }) }); const json = await res.json(); if (!res.ok) throw new Error(json.error); setActive({ ...active, wishlist }); setNotice("Вишлист сохранён"); setScreen("room"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось сохранить вишлист"); }
    finally { setBusy(false); }
  }
  const title = screen === "room" && active ? active.room.name : screen === "wishlist" ? "Мой вишлист" : screen === "admin" ? "Настройки комнаты" : screen === "create" ? "Новая комната" : screen === "join" ? "Войти в игру" : "Тайный Санта";

  return <main className="shell">
    <header className="topbar"><button className="brand" onClick={() => setScreen("home")} aria-label="На главную"><img className="brand-mark" src="/assets/illustrations/app-icon.webp" alt="" /><span>Тайный Санта</span></button><button className="avatar" aria-label="Профиль пользователя">{userName.slice(0, 1).toUpperCase()}</button></header>
    {screen !== "home" && <div className="subnav"><button className="back" onClick={() => setScreen(screen === "wishlist" || screen === "admin" ? "room" : "home")}>←</button><span>{title}</span><span className="small-mark">✳</span></div>}

    {booting && <div className="splash-screen" role="status"><img src="/assets/illustrations/santa-shh.webp" width="210" height="210" alt="" /><h1>Тайный Санта</h1><p>{tg()?.initDataUnsafe?.start_param ? "Открываем приглашение…" : "Тсс… готовим подарки"}</p><div className="candy-progress"><span/></div><small>Загружаем приложение</small></div>}

    {screen === "home" && <>
      <section className="hero"><div className="hero-label"><span className="dot" /> ВРЕМЯ ДАРИТЬ ЧУДЕСА</div><img className="hero-illustration" src="/assets/illustrations/home-tree.webp" width="300" height="245" alt="" /><h1>Тайный Санта</h1><p>Тяните имена, дарите подарки и храните секрет до праздника</p><button className="button button-dark hero-cta" onClick={() => { setCreateStep(1); setCreateDraft({ name: "", budget: "", drawAt: "", unlimited: false }); setScreen("create"); }}>Создать комнату <span>＋</span></button><button className="button button-light full" onClick={() => { setJoinCode(""); setScreen("join"); }}>Присоединиться к комнате <span>↗</span></button></section>
      <section className="rooms-section"><div className="section-heading"><div><div className="eyebrow">ВАШИ ИГРЫ</div><h2>Комнаты <span className="count">{allRooms.length.toString().padStart(2, "0")}</span></h2></div><button className="icon-button" onClick={() => { setJoinCode(""); setScreen("join"); }} aria-label="Ввести код комнаты">↗</button></div>
        {allRooms.length ? <div className="room-list">{allRooms.map((room, i) => <button className="room-row" key={room.id} onClick={() => void openRoom(room)}><span className={`room-icon room-icon-${i % 3}`}>{["✳", "❄", "✷"][i % 3]}</span><span className="room-copy"><strong>{room.name}</strong><small>{room.gift_budget ? `Бюджет до ${room.gift_budget.toLocaleString("ru-RU")} ₽` : "Без ограничения бюджета"} · {room.status === "drawn" ? "Распределение готово" : "Игра идёт"}</small></span><span className="room-arrow">↗</span></button>)}</div> : <div className="empty"><img className="empty-illustration" src="/assets/illustrations/home-tree.webp" width="180" height="150" alt="" /><strong>Пока тихо</strong><p>Создайте свою первую комнату или присоединитесь к друзьям по приглашению.</p><button className="text-button" onClick={() => setScreen("join")}>Есть приглашение? <span>→</span></button></div>}
      </section>
      <footer className="footer"><span>Сделано для маленьких чудес</span><span>✳</span><span>01 / 25</span></footer>
      {demo && <button className="demo-note" onClick={() => setNotice("Демонстрация интерфейса. Для реальной игры подключите Supabase и Telegram-бота.")}>Предпросмотр интерфейса <span>ⓘ</span></button>}
    </>}

    {screen === "room" && active && <section className="content-page"><div className="room-cover"><div className="room-cover-top"><span>СЕЗОН ПОДАРКОВ</span><span>✳</span></div><img className="cover-illustration" src={active.room.status === "drawn" ? "/assets/illustrations/result-tag.webp" : active.players.length === 1 ? "/assets/illustrations/invite-sent.webp" : "/assets/illustrations/draw-sack.webp"} width="136" height="136" alt="" /><div className="room-cover-bottom"><h1>{active.room.name}</h1><p>{active.room.gift_budget ? `Подарок до ${active.room.gift_budget.toLocaleString("ru-RU")} ₽` : "Пусть фантазия решает"}{active.room.draw_at ? ` · жеребьёвка ${new Date(active.room.draw_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}` : ""}</p></div></div>
        <div className="section-heading compact"><div><div className="eyebrow">В КРУГУ</div><h2>Участники <span className="count">{active.players.length.toString().padStart(2, "0")}</span></h2></div>{active.role === "admin" && <button className="icon-button" aria-label="Настройки" onClick={() => setScreen("admin")}>☷</button>}</div>
        <div className="participant-list">{active.players.map((player, i) => <div className="participant" key={player.telegram_id}><span className={`person-avatar person-${i % 5}`}><img src={`/assets/avatars/avatar-${String((i % 32) + 1).padStart(2, "0")}.webp`} width="48" height="48" alt="" /></span><span><strong>{player.full_name}</strong><small>{player.role === "admin" ? "Организатор" : "Участник"}</small></span>{player.telegram_id === Number(tg()?.initDataUnsafe?.user?.id) && <span className="you-badge">ЭТО ВЫ</span>}</div>)}</div>
        {active.recipient && <div className="match-card"><div className="eyebrow">ВАШ ТАЙНЫЙ САНТА-МАТЧ</div><h2>Вы дарите подарок<br/><em>{active.recipient.full_name}</em></h2>{active.recipient.wishlist?.title && <p>Вишлист: {active.recipient.wishlist.title}</p>}<span className="match-star">✳</span></div>}
        <button className="button button-dark full" onClick={() => setScreen("wishlist")}>✳　 Мой вишлист <span>↗</span></button>
        <button className="button button-light full" onClick={() => void copyInvite(active.room)}>Поделиться приглашением <span>⤴</span></button>
        <div className="room-footnote">Жеребьёвка тайная — ваш получатель известен только вам.</div>
      </section>}

    {screen === "wishlist" && <section className="form-page"><div className="form-intro"><div className="eyebrow">ПУСТЬ САНТЕ БУДЕТ ПРОЩЕ</div><h1>Немного <em>подсказок.</em></h1><p>Добавьте идеи в список или оставьте ссылку на готовый вишлист.</p></div>
      <form onSubmit={saveWishlist} className="form-stack">
        <div className="segment-controls"><button type="button" className={wishlistMode === "list" ? "active" : ""} onClick={() => setWishlistMode("list")}>Списком</button><button type="button" className={wishlistMode === "link" ? "active" : ""} onClick={() => setWishlistMode("link")}>Ссылкой</button></div>
        {wishlistMode === "link" ? <label>Ссылка на вишлист<input type="url" name="source_url" value={wishlistUrl} onChange={e => setWishlistUrl(e.target.value)} placeholder="https://…" required/><small>Подойдёт вишлист из любого сервиса или маркетплейса.</small></label> : <>
          {wishItems.length > 0 ? <div className="wish-list">{wishItems.map((wish, index) => <article className="wish-card" key={wish.id ?? index}><div className="wish-card-head"><strong>{wish.title}</strong>{wish.price && <b>{Number(wish.price).toLocaleString("ru-RU")} ₽</b>}</div>{wish.description && <p>{wish.description}</p>}{wish.product_url && <a href={wish.product_url} target="_blank" rel="noreferrer">{wish.product_url}</a>}<div className="wish-actions"><button type="button" onClick={() => { setWishDraft(wish); setEditingWish(index); }}>Изменить</button><button type="button" onClick={() => setWishItems(items => items.filter((_, i) => i !== index))}>Удалить</button></div></article>)}</div> : <div className="wish-empty"><img src="/assets/illustrations/wishlist-empty.webp" width="160" height="130" alt=""/><strong>Вишлист пуст</strong><p>Добавьте пару идей, и Санте будет проще выбрать подарок.</p></div>}
          <div className="wish-editor"><h2>{editingWish === null ? "Новое пожелание" : "Изменить пожелание"}</h2><label>Что подарить<input value={wishDraft.title ?? ""} maxLength={120} onChange={e => setWishDraft({ ...wishDraft, title: e.target.value })} placeholder="Например, книга"/></label><label>Подробности<textarea rows={3} maxLength={500} value={wishDraft.description ?? ""} onChange={e => setWishDraft({ ...wishDraft, description: e.target.value })} placeholder="Цвет, размер, чего точно не нужно"/></label><label>Ссылка на товар<input type="url" value={wishDraft.product_url ?? ""} onChange={e => setWishDraft({ ...wishDraft, product_url: e.target.value })} placeholder="https://…"/></label><label>Примерная цена, ₽<input inputMode="numeric" value={wishDraft.price ?? ""} onChange={e => setWishDraft({ ...wishDraft, price: e.target.value.replace(/\\D/g, "").slice(0, 7) })} placeholder="Необязательно"/></label><button type="button" className="button button-light full" onClick={saveWishDraft}>{editingWish === null ? "＋ Добавить пожелание" : "Сохранить пожелание"}</button></div>
        </>}
        <div className="wizard-actions"><button type="button" className="button button-light" onClick={() => setScreen("room")}>Отмена</button><button disabled={busy} className="button button-dark" type="submit">{busy ? "Сохраняем…" : "Сохранить"} <span>✓</span></button></div>
      </form></section>}

    {screen === "create" && <section className="form-page"><div className="form-intro"><div className="eyebrow">{createStep === 1 ? "ШАГ 1 ИЗ 2 · КОМНАТА" : "ШАГ 2 ИЗ 2 · О СЕБЕ"}</div><div className="wizard-steps"><span className={createStep === 1 ? "active" : "done"}></span><span className={createStep === 2 ? "active" : ""}></span></div><h1>{createStep === 1 ? <>Новая <em>комната.</em></> : <>Расскажите <em>о себе.</em></>}</h1><p>{createStep === 1 ? "Название и бюджет можно поменять позже." : "Санта узнает, что вам подарить."}</p></div>{createStep === 1 ? <form className="form-stack" onSubmit={e => { e.preventDefault(); if (!createDraft.name.trim()) return setNotice("Придумайте название комнаты"); if (!createDraft.unlimited && (!Number(createDraft.budget) || Number(createDraft.budget) < 1)) return setNotice("Укажите сумму или выберите без ограничений"); setNotice(""); setCreateStep(2); }}><label>Название комнаты<input required value={createDraft.name} onChange={e => setCreateDraft({ ...createDraft, name: e.target.value.slice(0, 80) })} placeholder="Например, Новый год в офисе" maxLength={80}/></label><label>Бюджет подарка, ₽<input inputMode="numeric" value={createDraft.unlimited ? "" : createDraft.budget} disabled={createDraft.unlimited} onChange={e => setCreateDraft({ ...createDraft, budget: e.target.value.replace(/\\D/g, "").slice(0, 7) })} placeholder="Например, 3 000"/></label>{!createDraft.unlimited && <div className="quick-budgets">{[1000,2000,3000,5000].map(value => <button type="button" key={value} className={createDraft.budget === String(value) ? "selected" : ""} onClick={() => setCreateDraft({ ...createDraft, budget: String(value) })}>{value.toLocaleString("ru-RU")} ₽</button>)}</div>}<label className="unlimited-toggle"><input type="checkbox" checked={createDraft.unlimited} onChange={e => setCreateDraft({ ...createDraft, unlimited: e.target.checked, budget: e.target.checked ? "" : createDraft.budget })}/>Без ограничений</label><label>Дата жеребьёвки<input type="date" value={createDraft.drawAt} onChange={e => setCreateDraft({ ...createDraft, drawAt: e.target.value })}/></label><button className="button button-dark full" type="submit">Дальше <span>→</span></button></form> : <form onSubmit={createRoom} className="form-stack"><input type="hidden" name="name" value={createDraft.name}/><input type="hidden" name="budget" value={createDraft.unlimited ? "" : createDraft.budget}/><input type="hidden" name="drawAt" value={createDraft.drawAt}/><div className="profile-preview"><img src="/assets/avatars/avatar-01.webp" width="84" height="84" alt=""/><span>Ваша аватарка. Её увидят все в комнате.</span></div><button className="avatar-reroll" type="button" onClick={() => setNotice("Аватарка будет закреплена при создании комнаты")}>⤨ Другая аватарка</button><label>Имя и фамилия<input required name="fullName" placeholder="Например, Александра Петрова" defaultValue={userName === "Санта" ? "" : userName} maxLength={120}/></label><div className="form-tip"><span>✳</span><p>Добавить пожелания можно сразу или позже в профиле.</p></div><div className="wizard-actions"><button type="button" className="button button-light" onClick={() => setCreateStep(1)}>Назад</button><button disabled={busy} className="button button-dark" type="submit">{busy ? "Создаём…" : "Создать комнату"} <span>🎁</span></button></div></form>}</section>}

    {screen === "join" && <section className="form-page"><div className="form-intro"><div className="eyebrow">ВАС УЖЕ ЖДУТ</div><h1>Входите,<br/><em>будет уютно.</em></h1><p>Откройте ссылку-приглашение или введите код комнаты.</p></div><form onSubmit={joinRoom} className="form-stack"><label>Код приглашения<input required value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Например, ab12cd34"/></label><label>Ваше имя и фамилия<input required name="fullName" placeholder="Александра Петрова" defaultValue={userName === "Санта" ? "" : userName}/></label><div className="form-tip"><span>✳</span><p>После входа добавьте вишлист — так вашему Санте будет проще выбрать подарок.</p></div><button disabled={busy} className="button button-dark full">Присоединиться <span>↗</span></button></form></section>}

    {screen === "admin" && active && <AdminPage active={active} demo={demo} initData={initData} setActive={setActive} setNotice={setNotice} setBusy={setBusy} busy={busy} />}
    {notice && <div className="toast" role="status"><span>✳</span>{notice}<button onClick={() => setNotice("")} aria-label="Закрыть">×</button></div>}
    {busy && <div className="loading" role="status">Секундочку…</div>}
  </main>;
}

function AdminPage({ active, demo, initData, setActive, setNotice, setBusy, busy }: { active: RoomData; demo: boolean; initData: string; setActive: (x: RoomData) => void; setNotice: (x: string) => void; setBusy: (x: boolean) => void; busy: boolean }) {
  const [pairs, setPairs] = useState<Array<[number, number]>>(active.exclusions);
  const [first, setFirst] = useState(""); const [second, setSecond] = useState("");
  async function update(action: "exclusions" | "draw", values?: unknown) {
    if (demo || active.room.id.startsWith("demo")) { setNotice(action === "draw" ? "Жеребьёвка доступна в подключённой версии" : "Пары сохранены в предпросмотре"); if (action === "exclusions") setActive({ ...active, exclusions: pairs }); return; }
    setBusy(true);
    try { const res = await fetch(`/api/rooms/${active.room.id}`, { method: "PUT", headers: { "content-type": "application/json", "x-telegram-init-data": initData }, body: JSON.stringify({ action, ...(action === "exclusions" ? { pairs: values } : {}) }) }); const json = await res.json(); if (!res.ok) throw new Error(json.error); if (action === "draw") { setNotice(`Жеребьёвка готова — ${json.count} подарков найдут адресатов!`); setActive({ ...active, room: { ...active.room, status: "drawn" } }); } else { setActive({ ...active, exclusions: pairs }); setNotice("Исключения сохранены"); } }
    catch (error) { setNotice(error instanceof Error ? error.message : "Не удалось сохранить"); }
    finally { setBusy(false); }
  }
  function addPair() { const a = Number(first), b = Number(second); if (!a || !b || a === b || pairs.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a))) return; setPairs([...pairs, [a, b]]); setFirst(""); setSecond(""); }
  return <section className="form-page"><div className="form-intro"><div className="eyebrow">ВАША КОМНАТА · ОРГАНИЗАТОР</div><h1>Всё <em>по парам.</em></h1><p>Отметьте людей, которым нельзя дарить друг другу. Например, близких родственников из одной семьи.</p></div><div className="form-stack"><div className="pair-select"><label>Первый участник<select value={first} onChange={e => setFirst(e.target.value)}><option value="">Выберите человека</option>{active.players.map(p => <option key={p.telegram_id} value={p.telegram_id}>{p.full_name}</option>)}</select></label><span className="pair-cross">×</span><label>Второй участник<select value={second} onChange={e => setSecond(e.target.value)}><option value="">Выберите человека</option>{active.players.map(p => <option key={p.telegram_id} value={p.telegram_id}>{p.full_name}</option>)}</select></label><button className="button button-light full" type="button" onClick={addPair}>+ Добавить исключение</button></div>{pairs.length > 0 && <div className="pair-list">{pairs.map((pair, i) => <div className="pair-row" key={`${pair[0]}-${pair[1]}`}><span>{active.players.find(p => p.telegram_id === pair[0])?.full_name ?? pair[0]}</span><i>×</i><span>{active.players.find(p => p.telegram_id === pair[1])?.full_name ?? pair[1]}</span><button onClick={() => setPairs(pairs.filter((_, n) => n !== i))} aria-label="Удалить пару">×</button></div>)}</div>}<button disabled={busy} className="button button-light full" onClick={() => void update("exclusions", pairs)}>Сохранить пары <span>✓</span></button><div className="form-tip"><span>✳</span><p>Перед жеребьёвкой убедитесь, что все успели вступить в комнату и добавить пожелания.</p></div><button disabled={busy || active.room.status === "drawn" || active.players.length < 3} className="button button-dark full" onClick={() => void update("draw")}><span>Провести тайную жеребьёвку</span><span>✳</span></button>{active.room.status === "drawn" && <p className="inline-note">Жеребьёвка уже проведена. Каждый участник увидит только своего получателя.</p>}{active.players.length < 3 && <p className="inline-note">Для жеребьёвки нужно минимум три участника.</p>}</div></section>;
}

