-- Run once in the SQL Editor of a dedicated Supabase project.
create extension if not exists pgcrypto;

create table if not exists public.santa_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 70),
  created_by bigint not null,
  invite_code text not null unique,
  gift_budget integer not null default 0 check (gift_budget >= 0),
  draw_at date,
  status text not null default 'open' check (status in ('open', 'drawn')),
  created_at timestamptz not null default now()
);

create table if not exists public.santa_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.santa_rooms(id) on delete cascade,
  telegram_id bigint not null,
  full_name text not null check (char_length(full_name) between 3 and 120),
  role text not null default 'player' check (role in ('admin', 'player')),
  created_at timestamptz not null default now(),
  unique (room_id, telegram_id)
);

create table if not exists public.santa_wishlists (
  room_id uuid not null,
  telegram_id bigint not null,
  source_url text,
  title text,
  description text,
  color text,
  size text,
  notes text,
  product_url text,
  price numeric(10, 2) check (price is null or price >= 0),
  updated_at timestamptz not null default now(),
  primary key (room_id, telegram_id),
  foreign key (room_id, telegram_id) references public.santa_participants(room_id, telegram_id) on delete cascade
);

create table if not exists public.santa_exclusions (
  room_id uuid not null references public.santa_rooms(id) on delete cascade,
  first_id bigint not null,
  second_id bigint not null,
  check (first_id < second_id),
  primary key (room_id, first_id, second_id),
  foreign key (room_id, first_id) references public.santa_participants(room_id, telegram_id) on delete cascade,
  foreign key (room_id, second_id) references public.santa_participants(room_id, telegram_id) on delete cascade
);

create table if not exists public.santa_assignments (
  room_id uuid not null references public.santa_rooms(id) on delete cascade,
  giver_id bigint not null,
  recipient_id bigint not null,
  created_at timestamptz not null default now(),
  check (giver_id <> recipient_id),
  primary key (room_id, giver_id),
  unique (room_id, recipient_id),
  foreign key (room_id, giver_id) references public.santa_participants(room_id, telegram_id) on delete cascade,
  foreign key (room_id, recipient_id) references public.santa_participants(room_id, telegram_id) on delete cascade
);

create or replace function public.create_santa_room(p_name text, p_creator_id bigint, p_invite_code text, p_gift_budget integer, p_draw_at date, p_full_name text)
returns uuid language plpgsql set search_path = '' as $$
declare new_room_id uuid;
begin
  insert into public.santa_rooms(name, created_by, invite_code, gift_budget, draw_at)
  values (p_name, p_creator_id, p_invite_code, greatest(coalesce(p_gift_budget, 0), 0), p_draw_at)
  returning id into new_room_id;
  insert into public.santa_participants(room_id, telegram_id, full_name, role)
  values (new_room_id, p_creator_id, p_full_name, 'admin');
  return new_room_id;
end;
$$;
revoke all on function public.create_santa_room(text, bigint, text, integer, date, text) from public, anon, authenticated;
grant execute on function public.create_santa_room(text, bigint, text, integer, date, text) to service_role;

create or replace function public.join_santa_room(p_invite_code text, p_telegram_id bigint, p_full_name text)
returns uuid language plpgsql set search_path = '' as $$
declare target_id uuid;
begin
  select id into target_id from public.santa_rooms where invite_code = p_invite_code and status = 'open' for update;
  if target_id is null then raise exception 'Invitation is invalid or registration is closed'; end if;
  insert into public.santa_participants(room_id, telegram_id, full_name, role)
  values (target_id, p_telegram_id, p_full_name, 'player')
  on conflict (room_id, telegram_id) do nothing;
  return target_id;
end;
$$;
revoke all on function public.join_santa_room(text, bigint, text) from public, anon, authenticated;
grant execute on function public.join_santa_room(text, bigint, text) to service_role;

-- All access goes through server routes, which verify Telegram's signed initData.
alter table public.santa_rooms enable row level security;
alter table public.santa_participants enable row level security;
alter table public.santa_wishlists enable row level security;
alter table public.santa_exclusions enable row level security;
alter table public.santa_assignments enable row level security;
revoke all on public.santa_rooms, public.santa_participants, public.santa_wishlists, public.santa_exclusions, public.santa_assignments from anon, authenticated;
grant all on public.santa_rooms, public.santa_participants, public.santa_wishlists, public.santa_exclusions, public.santa_assignments to service_role;

create or replace function public.set_santa_exclusions(p_room_id uuid, p_admin_id bigint, p_pairs jsonb)
returns void language plpgsql set search_path = '' as $$
declare pair jsonb;
begin
  if not exists (select 1 from public.santa_participants where room_id = p_room_id and telegram_id = p_admin_id and role = 'admin') then
    raise exception 'Only the room organizer can change excluded pairs';
  end if;
  if exists (select 1 from public.santa_rooms where id = p_room_id and status <> 'open') then
    raise exception 'The draw has already taken place';
  end if;
  delete from public.santa_exclusions where room_id = p_room_id;
  for pair in select value from jsonb_array_elements(p_pairs) loop
    if (pair->>0)::bigint = (pair->>1)::bigint then raise exception 'A player cannot be paired with themselves'; end if;
    insert into public.santa_exclusions(room_id, first_id, second_id)
    values (p_room_id, least((pair->>0)::bigint, (pair->>1)::bigint), greatest((pair->>0)::bigint, (pair->>1)::bigint));
  end loop;
end;
$$;
revoke all on function public.set_santa_exclusions(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.set_santa_exclusions(uuid, bigint, jsonb) to service_role;

create or replace function public.draw_secret_santa(p_room_id uuid, p_admin_id bigint)
returns integer language plpgsql set search_path = '' as $$
declare
  participants bigint[];
  recipients bigint[];
  n integer;
  attempt integer;
  i integer;
  valid_draw boolean;
begin
  if not exists (select 1 from public.santa_participants where room_id = p_room_id and telegram_id = p_admin_id and role = 'admin') then
    raise exception 'Only the room organizer can run the draw';
  end if;
  perform 1 from public.santa_rooms where id = p_room_id and status = 'open' for update;
  if not found then raise exception 'The draw is already complete or room does not exist'; end if;
  select array_agg(telegram_id order by random()) into participants from public.santa_participants where room_id = p_room_id;
  n := coalesce(array_length(participants, 1), 0);
  if n < 3 then raise exception 'At least three players are required'; end if;
  for attempt in 1..20000 loop
    select array_agg(u.value order by random()) into recipients from unnest(participants) as u(value);
    valid_draw := true;
    for i in 1..n loop
      if participants[i] = recipients[i] or exists (
        select 1 from public.santa_exclusions e where e.room_id = p_room_id
          and e.first_id = least(participants[i], recipients[i]) and e.second_id = greatest(participants[i], recipients[i])
      ) then valid_draw := false; exit; end if;
    end loop;
    if valid_draw and exists (
      select 1
      from generate_subscripts(participants, 1) as a(i)
      join generate_subscripts(participants, 1) as b(j) on a.i < b.j
      where recipients[a.i] = participants[b.j]
        and recipients[b.j] = participants[a.i]
    ) then
      valid_draw := false;
    end if;
    if valid_draw then
      insert into public.santa_assignments(room_id, giver_id, recipient_id)
      select p_room_id, participants[s.i], recipients[s.i] from generate_subscripts(participants, 1) as s(i);
      update public.santa_rooms set status = 'drawn' where id = p_room_id;
      return n;
    end if;
  end loop;
  raise exception 'Could not find a valid draw with the current exclusions. Remove one or more pairs and try again.';
end;
$$;
revoke all on function public.draw_secret_santa(uuid, bigint) from public, anon, authenticated;
grant execute on function public.draw_secret_santa(uuid, bigint) to service_role;

create policy santa_rooms_service_role on public.santa_rooms for all to service_role using (true) with check (true);
create policy santa_participants_service_role on public.santa_participants for all to service_role using (true) with check (true);
create policy santa_wishlists_service_role on public.santa_wishlists for all to service_role using (true) with check (true);
create policy santa_exclusions_service_role on public.santa_exclusions for all to service_role using (true) with check (true);
create policy santa_assignments_service_role on public.santa_assignments for all to service_role using (true) with check (true);
create index santa_exclusions_room_second_idx on public.santa_exclusions(room_id, second_id);

