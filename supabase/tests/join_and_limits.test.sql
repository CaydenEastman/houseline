-- Database checks for joining and limits. Run this AFTER schema.sql, in the Supabase SQL editor.
-- It makes three throwaway users, exercises accept_invite_v2 (counted failures, 10 tries an hour, lowercase and spaces,
-- used and expired codes), tries direct writes to the household tables (must be refused) and crash-report back-dating
-- (must not dodge the cap), and then ENDS WITH AN ERROR ON PURPOSE so nothing is kept. Expected result text:
--   RESULT wrong:invalid typo:invalid attempts_after_2_failures=2 after10:throttled C:JOINED C_in_A_household=1
--          reuse:used expired:expired direct_insert_refused=true direct_update_refused=true errors_capped=true backdated_rows=0

do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  inv jsonb; icode text; r jsonb; n int; out text := ''; ok boolean;
begin
  insert into auth.users (id, aud, role, email) values (a,'authenticated','authenticated','a-test@test.invalid'),(b,'authenticated','authenticated','b-test@test.invalid'),(c,'authenticated','authenticated','c-test@test.invalid');
  -- owner A makes an invite
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  inv := public.create_invite(); icode := inv->>'code';
  -- B tries wrong codes: each failure is answered (not raised) AND counted
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.accept_invite_v2('ZZZZ9999'); out := out || 'wrong:' || (r->>'error') || ' ';
  r := public.accept_invite_v2('nope'); out := out || 'typo:' || (r->>'error') || ' ';
  reset role;
  select count(*) into n from public.invite_attempts where user_id = b; out := out || 'attempts_after_2_failures=' || n || ' ';
  set local role authenticated;
  for i in 1..8 loop perform public.accept_invite_v2('ZZZZ9999'); end loop;
  r := public.accept_invite_v2(icode); out := out || 'after10:' || coalesce(r->>'error','JOINED') || ' ';
  -- a fresh person C: lowercase + spaces accepted, then the code cannot be reused
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.accept_invite_v2(lower(substr(icode,1,4)) || ' - ' || lower(substr(icode,5,4))); out := out || 'C:' || coalesce(r->>'error','JOINED') || ' ';
  reset role;
  select count(*) into n from public.household_members where user_id = c and household_id = (select household_id from public.household_members where user_id = a); out := out || 'C_in_A_household=' || n || ' ';
  -- used code
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  delete from public.invite_attempts where user_id = b;
  set local role authenticated;
  r := public.accept_invite_v2(icode); out := out || 'reuse:' || coalesce(r->>'error','JOINED') || ' ';
  -- expired
  reset role;
  update public.household_invites set used_at = null, used_by = null, expires_at = now() - interval '1 minute' where public.household_invites.code = icode;
  set local role authenticated;
  r := public.accept_invite_v2(icode); out := out || 'expired:' || coalesce(r->>'error','JOINED') || ' ';
  -- direct table writes are refused
  ok := false;
  begin insert into public.household_members (household_id, user_id, role) values ((select household_id from public.household_members where user_id = a), b, 'member'); exception when insufficient_privilege then ok := true; end;
  out := out || 'direct_insert_refused=' || ok || ' ';
  ok := false;
  begin update public.household_members set role = 'owner' where user_id = c; exception when insufficient_privilege then ok := true; end;
  out := out || 'direct_update_refused=' || ok || ' ';
  -- crash reports: back-dated timestamps no longer dodge the cap
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  for i in 1..49 loop insert into public.client_errors (message, at) values ('e'||i, now() - interval '3 days'); end loop;
  ok := false;
  begin for i in 1..5 loop insert into public.client_errors (message, at) values ('x'||i, now() - interval '3 days'); end loop; exception when others then ok := true; end;
  out := out || 'errors_capped=' || ok || ' ';
  reset role;
  select count(*) into n from public.client_errors where user_id = c and at < now() - interval '1 day'; out := out || 'backdated_rows=' || n;
  raise exception 'RESULT %', out;
end $$;
