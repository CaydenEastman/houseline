-- Man of the House: Supabase schema. Paste into Supabase, SQL Editor, and run once.
-- Safe to re-run: every statement is idempotent.

-- A household owns one set of app data. Today each user gets one; sharing (invite another member) reuses these tables.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user_idx on public.household_members(user_id);

-- The app's state, split into small documents (main + history chunks), exactly as the app already shards it.
create table if not exists public.docs (
  household_id uuid not null references public.households(id) on delete cascade,
  path text not null check (length(path) between 1 and 200),
  data jsonb not null check (pg_column_size(data) < 1000000),
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (household_id, path)
);

-- A short-lived lock so two phones don't write at the same instant.
create table if not exists public.locks (
  household_id uuid primary key references public.households(id) on delete cascade,
  holder text not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now()
);
alter table public.locks add column if not exists acquired_at timestamptz not null default now();

-- Abuse caps: a household can hold at most 500 docs (history chunks are ~200 KB, so this is far above real use).
create or replace function public.docs_cap() returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.docs d where d.household_id = new.household_id) >= 500 then
    raise exception 'too many documents in this household';
  end if;
  return new;
end $$;
drop trigger if exists docs_cap on public.docs;
create trigger docs_cap before insert on public.docs for each row execute function public.docs_cap();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.docs enable row level security;
alter table public.locks enable row level security;

-- Membership check used by every policy. security definer avoids a recursive policy on household_members.
create or replace function public.is_member(hh uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid());
$$;

drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated using (public.is_member(id));

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members for select to authenticated using (user_id = auth.uid() or public.is_member(household_id));

drop policy if exists docs_select on public.docs;
create policy docs_select on public.docs for select to authenticated using (public.is_member(household_id));
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (public.is_member(household_id));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using (public.is_member(household_id));
-- locks have no direct policies on purpose: only the functions below touch them.

-- First sign-in: create the caller's household (once) and return its id.
create or replace function public.ensure_household()
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0)); -- two parallel first requests must not create two households
  select m.household_id into hh from public.household_members m where m.user_id = auth.uid() order by m.created_at limit 1;
  if hh is null then
    insert into public.households (created_by) values (auth.uid()) returning id into hh;
    insert into public.household_members (household_id, user_id, role) values (hh, auth.uid(), 'owner');
  end if;
  return hh;
end $$;

create or replace function public.acquire_lock(holder text, ttl_ms integer default 8000)
returns boolean language plpgsql security definer set search_path = public as $$
declare hh uuid; got boolean;
begin
  hh := public.ensure_household();
  with up as (
    insert into public.locks as l (household_id, holder, expires_at)
    values (hh, holder, now() + (least(greatest(coalesce(ttl_ms, 8000), 1000), 30000) || ' milliseconds')::interval)
    on conflict (household_id) do update set holder = excluded.holder, expires_at = excluded.expires_at,
      acquired_at = case when l.holder = excluded.holder and l.expires_at >= now() then l.acquired_at else now() end
      -- the same holder may renew, but no one keeps the lock for more than a minute straight
      where (l.holder = excluded.holder and l.acquired_at > now() - interval '60 seconds') or l.expires_at < now()
    returning 1)
  select exists (select 1 from up) into got;
  return got;
end $$;

create or replace function public.release_lock(holder text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.locks l where l.household_id = public.ensure_household() and l.holder = release_lock.holder;
end $$;

revoke all on function public.ensure_household(), public.acquire_lock(text, integer), public.release_lock(text), public.is_member(uuid) from public, anon;
grant execute on function public.ensure_household(), public.acquire_lock(text, integer), public.release_lock(text), public.is_member(uuid) to authenticated;

-- Least privilege: signed-out visitors get nothing; signed-in users get only what the policies then filter.
revoke all on public.households, public.household_members, public.docs, public.locks from anon;
revoke all on public.locks from authenticated;
grant select on public.households, public.household_members to authenticated;
grant select, insert, update, delete on public.docs to authenticated;

-- Photos: a private bucket, one folder per household. Only members can read or write their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function public.photo_folder_ok(name text)
returns boolean language sql stable set search_path = public as $$
  select case when array_length(storage.foldername(name), 1) = 1 and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_member(((storage.foldername(name))[1])::uuid) else false end;
$$;
revoke execute on function public.photo_folder_ok(text) from public, anon;
grant execute on function public.photo_folder_ok(text) to authenticated;

drop policy if exists photos_select on storage.objects;
create policy photos_select on storage.objects for select to authenticated using (bucket_id = 'photos' and public.photo_folder_ok(name));
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.photo_folder_ok(name));
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update to authenticated using (bucket_id = 'photos' and public.photo_folder_ok(name)) with check (bucket_id = 'photos' and public.photo_folder_ok(name));
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.photo_folder_ok(name));

-- Instant updates: tell the Realtime service to announce changes to docs (row-level security still decides who hears them).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- ===== Household sharing, leaving, and account deletion =====
-- One household per person (sharing moves you into someone else's household, it never makes you a member of two).
create unique index if not exists household_members_one_per_user on public.household_members(user_id);

create table if not exists public.household_invites (
  code text primary key check (code ~ '^[A-Z2-9]{8}$'),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  used_by uuid references auth.users(id) on delete set null,
  used_at timestamptz
);
create index if not exists household_invites_hh_idx on public.household_invites(household_id);
create table if not exists public.invite_attempts (
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists invite_attempts_idx on public.invite_attempts(user_id, at);
alter table public.household_invites enable row level security;
alter table public.invite_attempts enable row level security;
revoke all on public.household_invites, public.invite_attempts from anon, authenticated;

-- Who is in my household, what is my role, and (owners only) the current invite code.
create or replace function public.household_info()
returns jsonb language plpgsql security definer set search_path = public as $$
declare hh uuid; me text; inv jsonb;
begin
  hh := public.ensure_household();
  select m.role into me from public.household_members m where m.household_id = hh and m.user_id = auth.uid();
  if me = 'owner' then
    select jsonb_build_object('code', i.code, 'expires_at', i.expires_at) into inv
      from public.household_invites i where i.household_id = hh and i.used_at is null and i.expires_at > now()
      order by i.expires_at desc limit 1;
  end if;
  return jsonb_build_object(
    'household_id', hh, 'role', me, 'invite', inv,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role, 'me', m.user_id = auth.uid()) order by m.created_at), '[]'::jsonb)
                from public.household_members m join auth.users u on u.id = m.user_id where m.household_id = hh));
end $$;

-- Owner makes a one-time code that works for 7 days. A new code replaces any unused older one.
create or replace function public.create_invite()
returns jsonb language plpgsql security definer set search_path = public as $$
declare hh uuid; c text := ''; b bytea; i int; alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; exp timestamptz := now() + interval '7 days';
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can invite people';
  end if;
  if (select count(*) from public.household_members m where m.household_id = hh) >= 6 then
    raise exception 'A household can have at most 6 people';
  end if;
  delete from public.household_invites where household_id = hh and used_at is null;
  loop
    b := uuid_send(gen_random_uuid()); c := '';
    for i in 0..7 loop c := c || substr(alpha, (get_byte(b, i + 6) % 31) + 1, 1); end loop;
    begin
      insert into public.household_invites (code, household_id, created_by, expires_at) values (c, hh, auth.uid(), exp);
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('code', c, 'expires_at', exp);
end $$;

create or replace function public.cancel_invite()
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can cancel an invite';
  end if;
  delete from public.household_invites where household_id = hh and used_at is null;
end $$;

-- Join someone's household with their code. Your own (empty or solo) household is deleted: its data is replaced by theirs.
create or replace function public.accept_invite(invite_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare mine uuid; inv public.household_invites; norm text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts a where a.user_id = auth.uid() and a.at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many tries. Wait an hour and try again.';
  end if;
  insert into public.invite_attempts (user_id) values (auth.uid());
  norm := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into inv from public.household_invites i where i.code = norm and i.used_at is null and i.expires_at > now() for update;
  if not found then raise exception 'That code is not valid or has expired.'; end if;
  mine := public.ensure_household();
  if mine = inv.household_id then raise exception 'You are already in this household.'; end if;
  if (select count(*) from public.household_members m where m.household_id = mine) > 1 then
    raise exception 'Leave your current household before joining another one.';
  end if;
  if (select count(*) from public.household_members m where m.household_id = inv.household_id) >= 6 then
    raise exception 'That household is full.';
  end if;
  delete from public.households where id = mine;  -- solo household: its documents and membership go with it
  insert into public.household_members (household_id, user_id, role) values (inv.household_id, auth.uid(), 'member');
  update public.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return inv.household_id;
end $$;

-- Leave a shared household and get a fresh one of your own. The owner has to remove everyone else first.
create or replace function public.leave_household()
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid; me text;
begin
  hh := public.ensure_household();
  select m.role into me from public.household_members m where m.household_id = hh and m.user_id = auth.uid();
  if (select count(*) from public.household_members m where m.household_id = hh) = 1 then return hh; end if; -- already alone
  if me = 'owner' then raise exception 'Remove the other people first (or make someone else the owner).'; end if;
  delete from public.household_members where household_id = hh and user_id = auth.uid();
  return public.ensure_household();
end $$;

create or replace function public.remove_member(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  hh := public.ensure_household();
  if target = auth.uid() then raise exception 'Use Leave to remove yourself.'; end if;
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can remove people';
  end if;
  delete from public.household_members where household_id = hh and user_id = target;
  if not found then raise exception 'That person is not in your household.'; end if;
end $$;

create or replace function public.make_owner(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can do that';
  end if;
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = target) then raise exception 'That person is not in your household.'; end if;
  update public.household_members set role = 'owner' where household_id = hh and user_id = target;
  update public.household_members set role = 'member' where household_id = hh and user_id = auth.uid() and target <> auth.uid();
end $$;

-- Permanently delete the caller's account. Alone in the household: the household and all its data go too.
-- Others in it: the oldest remaining person becomes owner and keeps the shared data. (Photo files are removed by the app first.)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid; me text; heir uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select m.household_id, m.role into hh, me from public.household_members m where m.user_id = auth.uid() limit 1;
  if hh is not null then
    if (select count(*) from public.household_members m where m.household_id = hh) = 1 then
      delete from public.households where id = hh;
    else
      if me = 'owner' then
        select m.user_id into heir from public.household_members m where m.household_id = hh and m.user_id <> auth.uid() order by m.created_at limit 1;
        update public.household_members set role = 'owner' where household_id = hh and user_id = heir;
      end if;
      delete from public.household_members where household_id = hh and user_id = auth.uid();
    end if;
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.household_info(), public.create_invite(), public.cancel_invite(), public.accept_invite(text), public.leave_household(),
  public.remove_member(uuid), public.make_owner(uuid), public.delete_my_account() from public, anon;
grant execute on function public.household_info(), public.create_invite(), public.cancel_invite(), public.accept_invite(text), public.leave_household(),
  public.remove_member(uuid), public.make_owner(uuid), public.delete_my_account() to authenticated;

-- ===== Nightly backups (14 days) and error log =====
create table if not exists public.docs_snapshots (
  household_id uuid not null references public.households(id) on delete cascade,
  taken_on date not null,
  path text not null,
  data jsonb not null,
  primary key (household_id, taken_on, path)
);
alter table public.docs_snapshots enable row level security;
revoke all on public.docs_snapshots from anon, authenticated;

-- Copy every household's documents into today's snapshot and drop snapshots older than 14 days. Run nightly by pg_cron.
create or replace function public.take_snapshots()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.docs_snapshots (household_id, taken_on, path, data)
    select d.household_id, (now() at time zone 'utc')::date, d.path, d.data from public.docs d
  on conflict (household_id, taken_on, path) do update set data = excluded.data;
  get diagnostics n = row_count;
  delete from public.docs_snapshots where taken_on < (now() at time zone 'utc')::date - 14;
  return n;
end $$;
revoke all on function public.take_snapshots() from public, anon, authenticated;

-- The days I can go back to, newest first, with how many tasks each had.
create or replace function public.list_snapshots()
returns jsonb language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  hh := public.ensure_household();
  return coalesce((select jsonb_agg(jsonb_build_object('day', s.taken_on, 'tasks', case when jsonb_typeof(m.data->'tasks') = 'array' then jsonb_array_length(m.data->'tasks') end) order by s.taken_on desc)
    from (select distinct taken_on from public.docs_snapshots where household_id = hh) s
    left join public.docs_snapshots m on m.household_id = hh and m.taken_on = s.taken_on and m.path = 'household/main'), '[]'::jsonb);
end $$;

-- Owner only. First saves the current data as today's snapshot (so the restore can be undone by restoring today), then swaps in the chosen day.
create or replace function public.restore_snapshot(day date)
returns integer language plpgsql security definer set search_path = public as $$
declare hh uuid; n integer; today date := (now() at time zone 'utc')::date;
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can restore a backup';
  end if;
  if not exists (select 1 from public.docs_snapshots s where s.household_id = hh and s.taken_on = day) then
    raise exception 'There is no backup for that day.';
  end if;
  if day <> today then
    delete from public.docs_snapshots where household_id = hh and taken_on = today;
    insert into public.docs_snapshots (household_id, taken_on, path, data) select d.household_id, today, d.path, d.data from public.docs d where d.household_id = hh;
  end if;
  delete from public.docs where household_id = hh;
  insert into public.docs (household_id, path, data, updated_at)
    select hh, r.path, r.data, (extract(epoch from clock_timestamp()) * 1000)::bigint from public.docs_snapshots r where r.household_id = hh and r.taken_on = day;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.list_snapshots(), public.restore_snapshot(date) from public, anon;
grant execute on function public.list_snapshots(), public.restore_snapshot(date) to authenticated;

-- App errors people hit, so crashes are heard about. Insert-only for signed-in users; nobody can read it from the app.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  message text not null check (length(message) <= 500),
  stack text check (length(stack) <= 3000),
  page text check (length(page) <= 200),
  agent text check (length(agent) <= 250),
  version text check (length(version) <= 40)
);
create index if not exists client_errors_at_idx on public.client_errors(at);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;
grant insert on public.client_errors to authenticated;
drop policy if exists client_errors_insert on public.client_errors;
create policy client_errors_insert on public.client_errors for insert to authenticated with check (user_id = auth.uid());
-- (the crash-report cap function is defined in "Safer joining and tighter permissions" below)
drop trigger if exists client_errors_cap on public.client_errors;
create trigger client_errors_cap before insert on public.client_errors for each row execute function public.client_errors_cap();
revoke all on function public.client_errors_cap() from public, anon, authenticated;

-- Schedules (run once; pg_cron and pg_net are enabled in the dashboard under Database, Extensions):
--   select cron.schedule('nightly-snapshots', '15 9 * * *', 'select public.take_snapshots()');
--   select cron.schedule('prune-client-errors', '30 9 * * *', $$delete from public.client_errors where at < now() - interval '30 days'$$);

-- ===== Safer joining and tighter permissions =====
-- accept_invite_v2 answers with a result instead of raising, so a failed try is still counted by the hourly limit
-- (a raised error rolls back the count along with everything else), and it says WHY a code failed.
create or replace function public.accept_invite_v2(invite_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mine uuid; inv public.household_invites; norm text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts a where a.user_id = auth.uid() and a.at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'throttled', 'message', 'Too many tries. Wait an hour and try again.');
  end if;
  insert into public.invite_attempts (user_id) values (auth.uid());
  norm := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into inv from public.household_invites i where i.code = norm for update;
  if not found then return jsonb_build_object('error', 'invalid', 'message', 'That code does not match. Check it for typos, or ask for a new one.'); end if;
  if inv.used_at is not null then return jsonb_build_object('error', 'used', 'message', 'That code was already used. Ask for a new one.'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('error', 'expired', 'message', 'That code has expired. Ask for a new one.'); end if;
  mine := public.ensure_household();
  if mine = inv.household_id then return jsonb_build_object('error', 'already_member', 'message', 'You are already in this household.'); end if;
  if (select count(*) from public.household_members m where m.household_id = mine) > 1 then
    return jsonb_build_object('error', 'in_shared', 'message', 'You are already in a shared household. Leave it first (You, Account, Household).');
  end if;
  if (select count(*) from public.household_members m where m.household_id = inv.household_id) >= 6 then
    return jsonb_build_object('error', 'full', 'message', 'That household is full.');
  end if;
  delete from public.households where id = mine;  -- solo household: its documents and membership go with it
  insert into public.household_members (household_id, user_id, role) values (inv.household_id, auth.uid(), 'member');
  update public.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  return jsonb_build_object('household_id', inv.household_id);
end $$;
revoke all on function public.accept_invite_v2(text) from public, anon;
grant execute on function public.accept_invite_v2(text) to authenticated;

-- A crash report always carries the real time: the daily cap cannot be dodged by sending back-dated rows.
create or replace function public.client_errors_cap() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.at := now();
  if (select count(*) from public.client_errors e where e.user_id = new.user_id and e.at > now() - interval '1 day') >= 50 then
    raise exception 'too many error reports';
  end if;
  return new;
end $$;

-- Household tables are changed only through the functions above, never directly.
revoke insert, update, delete, truncate, references, trigger on public.households, public.household_members from authenticated;

-- ---------- Quiet days for reminders (migration "push_quiet_days") ----------
-- Weekdays (0 = Sunday ... 6 = Saturday) on which a phone gets no reminder.
alter table public.push_subscriptions add column if not exists quiet_days smallint[] not null default '{}';
alter table public.push_subscriptions drop constraint if exists push_quiet_days_valid;
alter table public.push_subscriptions add constraint push_quiet_days_valid check (quiet_days <@ array[0,1,2,3,4,5,6]::smallint[]);

-- search_path note: every security-definer function pins search_path=public, and neither anon nor authenticated can
-- CREATE in schema public, so nobody can plant look-alike objects. Rewriting them to an empty path is not needed.
-- ===== View-only members, join notices =====
alter table public.household_members add column if not exists can_edit boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'owner_can_edit') then
    alter table public.household_members add constraint owner_can_edit check (role <> 'owner' or can_edit);
  end if;
end $$;
alter table public.household_invites add column if not exists view_only boolean not null default false;

create or replace function public.is_editor(hh uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.can_edit);
$$;
revoke execute on function public.is_editor(uuid) from public, anon;
grant execute on function public.is_editor(uuid) to authenticated;

drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (public.is_editor(household_id));
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated using (public.is_editor(household_id)) with check (public.is_editor(household_id));
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using (public.is_editor(household_id));

create or replace function public.photo_folder_edit_ok(name text)
returns boolean language sql stable set search_path = public as $$
  select case when array_length(storage.foldername(name), 1) = 1 and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_editor(((storage.foldername(name))[1])::uuid) else false end;
$$;
revoke execute on function public.photo_folder_edit_ok(text) from public, anon;
grant execute on function public.photo_folder_edit_ok(text) to authenticated;
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.photo_folder_edit_ok(name));
drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects for update to authenticated using (bucket_id = 'photos' and public.photo_folder_edit_ok(name)) with check (bucket_id = 'photos' and public.photo_folder_edit_ok(name));
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.photo_folder_edit_ok(name));

-- A view-only person cannot take the write lock either.
create or replace function public.acquire_lock(holder text, ttl_ms integer default 8000)
returns boolean language plpgsql security definer set search_path = public as $$
declare hh uuid; got boolean;
begin
  hh := public.ensure_household();
  if not public.is_editor(hh) then return false; end if;
  with up as (
    insert into public.locks as l (household_id, holder, expires_at)
    values (hh, holder, now() + (least(greatest(coalesce(ttl_ms, 8000), 1000), 30000) || ' milliseconds')::interval)
    on conflict (household_id) do update set holder = excluded.holder, expires_at = excluded.expires_at,
      acquired_at = case when l.holder = excluded.holder and l.expires_at >= now() then l.acquired_at else now() end
      where (l.holder = excluded.holder and l.acquired_at > now() - interval '60 seconds') or l.expires_at < now()
    returning 1)
  select exists (select 1 from up) into got;
  return got;
end $$;

-- Members now report can_edit; the owner's invite reports whether it is view-only.
create or replace function public.household_info()
returns jsonb language plpgsql security definer set search_path = public as $$
declare hh uuid; me text; inv jsonb; ce boolean;
begin
  hh := public.ensure_household();
  select m.role, m.can_edit into me, ce from public.household_members m where m.household_id = hh and m.user_id = auth.uid();
  if me = 'owner' then
    select jsonb_build_object('code', i.code, 'expires_at', i.expires_at, 'view_only', i.view_only) into inv
      from public.household_invites i where i.household_id = hh and i.used_at is null and i.expires_at > now()
      order by i.expires_at desc limit 1;
  end if;
  return jsonb_build_object(
    'household_id', hh, 'role', me, 'can_edit', ce, 'invite', inv,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'email', u.email, 'role', m.role, 'can_edit', m.can_edit, 'me', m.user_id = auth.uid()) order by m.created_at), '[]'::jsonb)
                from public.household_members m join auth.users u on u.id = m.user_id where m.household_id = hh));
end $$;

drop function if exists public.create_invite();
create or replace function public.create_invite(view_only boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare hh uuid; c text := ''; b bytea; i int; alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; exp timestamptz := now() + interval '7 days';
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can invite people';
  end if;
  if (select count(*) from public.household_members m where m.household_id = hh) >= 6 then
    raise exception 'A household can have at most 6 people';
  end if;
  delete from public.household_invites where household_id = hh and used_at is null;
  loop
    b := uuid_send(gen_random_uuid()); c := '';
    for i in 0..7 loop c := c || substr(alpha, (get_byte(b, i + 6) % 31) + 1, 1); end loop;
    begin
      insert into public.household_invites (code, household_id, created_by, expires_at, view_only) values (c, hh, auth.uid(), exp, coalesce(create_invite.view_only, false));
      exit;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('code', c, 'expires_at', exp, 'view_only', coalesce(create_invite.view_only, false));
end $$;
revoke all on function public.create_invite(boolean) from public, anon;
grant execute on function public.create_invite(boolean) to authenticated;

-- Owner switches someone between "can edit" and "view only".
create or replace function public.set_member_edit(target uuid, allow boolean)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can do that';
  end if;
  if target = auth.uid() then raise exception 'The owner can always edit.'; end if;
  update public.household_members set can_edit = coalesce(allow, true) where household_id = hh and user_id = target;
  if not found then raise exception 'That person is not in your household.'; end if;
end $$;
revoke all on function public.set_member_edit(uuid, boolean) from public, anon;
grant execute on function public.set_member_edit(uuid, boolean) to authenticated;

-- Joining honours a view-only invite and leaves a notice for the people already there.
create table if not exists public.join_notices (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  who text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.join_notices enable row level security;
revoke all on public.join_notices from anon, authenticated;

create or replace function public.accept_invite_v2(invite_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare mine uuid; inv public.household_invites; norm text; who text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from public.invite_attempts where at < now() - interval '1 day';
  if (select count(*) from public.invite_attempts a where a.user_id = auth.uid() and a.at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('error', 'throttled', 'message', 'Too many tries. Wait an hour and try again.');
  end if;
  insert into public.invite_attempts (user_id) values (auth.uid());
  norm := upper(regexp_replace(coalesce(invite_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into inv from public.household_invites i where i.code = norm for update;
  if not found then return jsonb_build_object('error', 'invalid', 'message', 'That code does not match. Check it for typos, or ask for a new one.'); end if;
  if inv.used_at is not null then return jsonb_build_object('error', 'used', 'message', 'That code was already used. Ask for a new one.'); end if;
  if inv.expires_at <= now() then return jsonb_build_object('error', 'expired', 'message', 'That code has expired. Ask for a new one.'); end if;
  mine := public.ensure_household();
  if mine = inv.household_id then return jsonb_build_object('error', 'already_member', 'message', 'You are already in this household.'); end if;
  if (select count(*) from public.household_members m where m.household_id = mine) > 1 then
    return jsonb_build_object('error', 'in_shared', 'message', 'You are already in a shared household. Leave it first (You, Account, Household).');
  end if;
  if (select count(*) from public.household_members m where m.household_id = inv.household_id) >= 6 then
    return jsonb_build_object('error', 'full', 'message', 'That household is full.');
  end if;
  select coalesce(u.email, 'Someone') into who from auth.users u where u.id = auth.uid();
  delete from public.households where id = mine;
  insert into public.household_members (household_id, user_id, role, can_edit) values (inv.household_id, auth.uid(), 'member', not inv.view_only);
  update public.household_invites set used_by = auth.uid(), used_at = now() where code = inv.code;
  insert into public.join_notices (household_id, who) values (inv.household_id, who);
  return jsonb_build_object('household_id', inv.household_id, 'can_edit', not inv.view_only);
end $$;
revoke all on function public.accept_invite_v2(text) from public, anon;
grant execute on function public.accept_invite_v2(text) to authenticated;

-- Ownership changes keep the "owner can always edit" rule.
create or replace function public.make_owner(target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  hh := public.ensure_household();
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'Only the owner can do that';
  end if;
  if not exists (select 1 from public.household_members m where m.household_id = hh and m.user_id = target) then raise exception 'That person is not in your household.'; end if;
  update public.household_members set role = 'owner', can_edit = true where household_id = hh and user_id = target;
  update public.household_members set role = 'member' where household_id = hh and user_id = auth.uid() and target <> auth.uid();
end $$;
revoke all on function public.make_owner(uuid) from public, anon;
grant execute on function public.make_owner(uuid) to authenticated;

-- Account deletion: an heir who was view-only becomes a full owner.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare hh uuid; me text; heir uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select m.household_id, m.role into hh, me from public.household_members m where m.user_id = auth.uid() limit 1;
  if hh is not null then
    if (select count(*) from public.household_members m where m.household_id = hh) = 1 then
      delete from public.households where id = hh;
    else
      if me = 'owner' then
        select m.user_id into heir from public.household_members m where m.household_id = hh and m.user_id <> auth.uid() order by m.created_at limit 1;
        update public.household_members set role = 'owner', can_edit = true where household_id = hh and user_id = heir;
      end if;
      delete from public.household_members where household_id = hh and user_id = auth.uid();
    end if;
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
