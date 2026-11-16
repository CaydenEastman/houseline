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
