-- Gather Event Studio: complete fresh-project database setup (2026-10-28).
-- Run this ENTIRE file once in the SQL Editor of a NEW Supabase project as postgres.
-- Requires Supabase Auth, auth.uid(), and the anon/authenticated roles.
-- NOT an upgrade script. Never run on the existing configured Gather project.
-- Includes schema, RLS, grants, functions, indexes and directory coordination.
-- No accounts, user data, credentials, Auth dashboard settings or migration history.
-- Execute as one transaction: any error rolls back the whole installation.
-- Source: the 16 local migrations below, in filename order. Keep this snapshot
-- synchronized when changing the local schema; no migration files are needed to run it.

begin;

do $gather_setup$
begin
	if to_regclass('public.events') is not null
		or exists (select 1 from pg_namespace where nspname = 'private') then
		raise exception 'Gather setup requires a new project without public.events or the private schema. No changes applied.';
	end if;
end $gather_setup$;

-- Source: 202610250001_accounts_and_plans.sql
-- SHA-256 of normalized source: 6448c969bfc69a3b24f5477c4e99be2cf6f65e7573a67d5b65bdbbac43c907cf
-- Run once in the SQL Editor of a NEW Supabase project.
-- No service-role credentials are required by the application.

create schema private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create table public.events (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
 name text not null check (length(name) between 1 and 160),
 description text not null check (length(description) <= 2000),
 kind text not null check (length(kind) <= 100),
 date date not null, location text not null check (length(location) <= 200),
 guests integer not null check (guests between 1 and 100000),
 confirmed bigint not null check (confirmed between 0 and 1000000000),
 pending bigint not null check (pending between 0 and 1000000000),
 spending_limit bigint not null check (spending_limit between 0 and 1000000000),
 revision integer not null check (revision >= 0),
 color text not null check (color in ('cobalt','peach','lavender')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index events_owner_idx on public.events(owner_id);
create table public.task_groups (
 event_id uuid not null references public.events(id) on delete cascade,
 id uuid not null, name text not null check (length(name) between 1 and 2000), position integer not null,
 primary key(event_id,id)
);
create table public.tasks (
 event_id uuid not null references public.events(id) on delete cascade,
 id uuid not null, group_id uuid not null,
 title text not null check (length(title) between 1 and 200),
 notes text not null check (length(notes)<=2000), owner_label text not null check(length(owner_label)<=80),
 due date, priority text not null check(priority in ('Low','Medium','High')),
 status text not null check(status in ('To do','In progress','Blocked','Done')),
 position integer not null, primary key(event_id,id),
 foreign key(event_id,group_id) references public.task_groups(event_id,id) on delete cascade
);
create table public.budget_items (
 event_id uuid not null references public.events(id) on delete cascade,
 id uuid not null, name text not null check(length(name)<=2000), category text not null check(length(category)<=2000),
 estimate bigint not null check(estimate between 0 and 1000000000),
 actual bigint not null check(actual between 0 and 1000000000),
 committed boolean not null, position integer not null, primary key(event_id,id)
);
create table public.resources (
 event_id uuid not null references public.events(id) on delete cascade,
 id uuid not null, name text not null check(length(name)<=2000), source text not null check(length(source)<=2000),
 status text not null check(status in ('Needed','Requested','Confirmed','Reconfirmation needed')),
 position integer not null, primary key(event_id,id)
);
create table public.agenda_items (
 event_id uuid not null references public.events(id) on delete cascade,
 id uuid not null, time time not null, title text not null check(length(title)<=2000),
 owner_label text not null check(length(owner_label)<=2000), position integer not null, primary key(event_id,id)
);
create table public.event_operations (
 event_id uuid not null references public.events(id) on delete cascade, operation_id uuid not null,
 expected_revision integer not null, payload_hash text not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(event_id,operation_id)
);

-- All tables have RLS, including children. Browser/client users have SELECT only.
-- Writes go through the bounded, ownership-checked atomic function below.
alter table public.events enable row level security;
create policy owner_read on public.events for select to authenticated using(owner_id=(select auth.uid()));
do $$
declare table_name text;
begin
 foreach table_name in array array['task_groups','tasks','budget_items','resources','agenda_items','event_operations'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('create policy owner_read on public.%I for select to authenticated using (exists (select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())))',table_name);
 end loop;
end $$;
revoke all on public.events,public.task_groups,public.tasks,public.budget_items,public.resources,public.agenda_items,public.event_operations from anon,authenticated;
grant select on public.events,public.task_groups,public.tasks,public.budget_items,public.resources,public.agenda_items to authenticated;

create function public.read_event_plan(p_event_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select jsonb_build_object(
  'id',e.id,'name',e.name,'description',e.description,'kind',e.kind,'date',e.date,
  'location',e.location,'guests',e.guests,'confirmed',e.confirmed,'pending',e.pending,
  'limit',e.spending_limit,'revision',e.revision,'color',e.color,
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.position) from public.task_groups g where g.event_id=e.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'groupId',t.group_id,'title',t.title,'notes',t.notes,'owner',t.owner_label,'due',coalesce(t.due::text,''),'priority',t.priority,'status',t.status) order by t.position) from public.tasks t where t.event_id=e.id),'[]'::jsonb),
  'budget',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'estimate',b.estimate,'actual',b.actual,'committed',b.committed) order by b.position) from public.budget_items b where b.event_id=e.id),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'source',r.source,'status',r.status) order by r.position) from public.resources r where r.event_id=e.id),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'time',left(a.time::text,5),'title',a.title,'owner',a.owner_label) order by a.position) from public.agenda_items a where a.event_id=e.id),'[]'::jsonb)
 ) from public.events e where e.id=p_event_id and e.owner_id=auth.uid()
$$;
create function public.read_event_plans() returns jsonb
language sql volatile security invoker set search_path='' as $$
 select coalesce(jsonb_agg(public.read_event_plan(e.id) order by e.created_at),'[]'::jsonb)
 from public.events e where e.owner_id=auth.uid()
$$;

create function private.write_event_plan(p_plan jsonb,p_expected_revision integer,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color')
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $$;

-- Keep privileged implementation outside the Data API schema.
-- Public entry point is invoker-only; private implementation still validates auth.uid().
create function public.write_event_plan(p_plan jsonb,p_expected_revision integer,p_operation_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $$
 select private.write_event_plan(p_plan,p_expected_revision,p_operation_id)
$$;
revoke all on function private.write_event_plan(jsonb,integer,uuid) from public,anon;
grant execute on function private.write_event_plan(jsonb,integer,uuid) to authenticated;
revoke all on function public.read_event_plan(uuid),public.read_event_plans(),public.write_event_plan(jsonb,integer,uuid) from public,anon;
grant execute on function public.read_event_plan(uuid),public.read_event_plans(),public.write_event_plan(jsonb,integer,uuid) to authenticated;


-- Source: 20261025191428_initial_plan_proposals.sql
-- SHA-256 of normalized source: bf156d27f84cf6a44dc1206b607a50400a54ae9a800133e9256f1d0e75ba2b3f
-- Additive hosted migration source; apply_migration assigns the migration version.
create table public.plan_proposals (
 id uuid primary key, event_id uuid not null references public.events(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 base_revision integer not null check(base_revision>=0),
 status text not null check(status in ('running','ready','failed','applied','discarded','rolled_back')),
 cache_key text not null check(length(cache_key)<=128),
 before_plan jsonb not null, plan jsonb,
 summary text not null default '', assumptions jsonb not null default '[]',
 provider text not null default '', model text not null default '',
 attempts integer not null default 0 check(attempts between 0 and 2),
 reserved_tokens integer not null default 32192 check(reserved_tokens=32192),
 applied_revision integer, created_at timestamptz not null default now(),
 lease_until timestamptz not null default now()+interval '2 minutes'
);
create index plan_proposals_owner_time on public.plan_proposals(owner_id,created_at);
create index plan_proposals_event_time on public.plan_proposals(event_id,created_at);
create index plan_proposals_created on public.plan_proposals(created_at);
alter table public.plan_proposals enable row level security;
create policy owner_read on public.plan_proposals for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.events e where e.id=event_id and e.owner_id=(select auth.uid())));
revoke all on public.plan_proposals from public,anon,authenticated;
grant select on public.plan_proposals to authenticated;

create function private.proposal_json(p public.plan_proposals) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'eventId',p.event_id,'baseRevision',p.base_revision,
  'status',p.status,'plan',p.plan,'summary',p.summary,'assumptions',p.assumptions,
  'provider',p.provider,'model',p.model,'attempts',p.attempts,'appliedRevision',p.applied_revision)
$$;
revoke all on function private.proposal_json(public.plan_proposals) from public,anon;
grant execute on function private.proposal_json(public.plan_proposals) to authenticated;

create function private.plan_proposal_action(p_action text,p_event uuid,p_id uuid,p_expected integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal public.plan_proposals%rowtype; current_plan jsonb; candidate jsonb; result jsonb;
 current_revision integer; total_cost bigint; day_start timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_event is null or p_action is null then raise exception 'Invalid request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into current_revision from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 -- Leases do not permit an abandoned request to block an event indefinitely.
 update public.plan_proposals set status='failed' where event_id=p_event and owner_id=auth.uid() and status='running' and lease_until<now();
 if p_action='list' then
  select coalesce(jsonb_agg(private.proposal_json(s.p) order by (s.p).created_at desc),'[]'::jsonb) into result
   from (select p from public.plan_proposals p where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) s;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from public.plan_proposals where id=p_id;
 if found and (proposal.owner_id<>auth.uid() or proposal.event_id<>p_event) then raise exception 'Proposal not found' using errcode='P0002'; end if;

 if p_action='reserve' then
  if found then
   if proposal.base_revision<>p_expected or proposal.cache_key<>coalesce(p_payload->>'cacheKey','') then raise exception 'Operation conflict' using errcode='40001'; end if;
   -- Never hand a second worker a live lease with the same operation ID.
   if proposal.status='running' then raise exception 'Generation busy' using errcode='P1002'; end if;
   return private.proposal_json(proposal);
  end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  if jsonb_array_length(current_plan->'tasks')+jsonb_array_length(current_plan->'budget')+
    jsonb_array_length(current_plan->'resources')+jsonb_array_length(current_plan->'agenda')<>0 then
   raise exception 'Initial generation requires empty event' using errcode='P1003';
  end if;
  select * into proposal from public.plan_proposals where event_id=p_event and owner_id=auth.uid()
   and base_revision=p_expected and cache_key=p_payload->>'cacheKey' and status='ready' order by created_at desc limit 1;
  if found then return private.proposal_json(proposal); end if;
  if exists(select 1 from public.plan_proposals where event_id=p_event and status='running' and lease_until>=now()) then raise exception 'Generation busy' using errcode='P1002'; end if;
  -- Serialize daily counters across events and users, before a provider is contacted.
  perform pg_advisory_xact_lock(hashtextextended('gatherai:daily-ai-quota',0));
  day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from public.plan_proposals where owner_id=auth.uid() and created_at>=day_start)>=5
   or (select count(*) from public.plan_proposals where created_at>=day_start)>=20 then
   raise exception 'Daily AI limit' using errcode='P1001';
  end if;
  insert into public.plan_proposals(id,event_id,owner_id,base_revision,status,cache_key,before_plan)
   values(p_id,p_event,auth.uid(),p_expected,'running',p_payload->>'cacheKey',current_plan) returning * into proposal;
  return private.proposal_json(proposal);
 end if;

 if proposal.id is null then raise exception 'Proposal not found' using errcode='P0002'; end if;
 if proposal.base_revision<>p_expected then raise exception 'Invalid base revision' using errcode='40001'; end if;
 if p_action='fail' then
  update public.plan_proposals set status='failed' where id=p_id and status='running' returning * into proposal;
  return '{}'::jsonb;
 elsif p_action='complete' then
  if proposal.status<>'running' or proposal.lease_until<now() then raise exception 'Expired generation' using errcode='P1002'; end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=p_payload->'plan';
  if candidate is null or octet_length(candidate::text)>262144
   or (candidate-array['groups','tasks','budget','resources','agenda']) is distinct from
     (proposal.before_plan-array['groups','tasks','budget','resources','agenda']) then raise exception 'Invalid generated plan' using errcode='22023'; end if;
  if jsonb_typeof(candidate->'groups') is distinct from 'array' or jsonb_typeof(candidate->'tasks') is distinct from 'array'
   or jsonb_typeof(candidate->'budget') is distinct from 'array' or jsonb_typeof(candidate->'resources') is distinct from 'array'
   or jsonb_typeof(candidate->'agenda') is distinct from 'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
  if jsonb_array_length(candidate->'groups') not between 1 and 5 or jsonb_array_length(candidate->'tasks') not between 1 and 20
   or jsonb_array_length(candidate->'budget')>10 or jsonb_array_length(candidate->'resources')>10
   or jsonb_array_length(candidate->'agenda')>10 then raise exception 'Invalid collection sizes' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(candidate->'budget') b where (b->>'actual')::bigint<>0 or (b->>'committed')::boolean is not false or (b->>'estimate')::bigint<0)
   or exists(select 1 from jsonb_array_elements(candidate->'tasks') t where t->>'status'<>'To do') then raise exception 'Invalid generated state' using errcode='22023'; end if;
  select coalesce(sum((b->>'estimate')::bigint),0) into total_cost from jsonb_array_elements(candidate->'budget') b;
  if total_cost>least((current_plan->>'confirmed')::bigint,(current_plan->>'limit')::bigint) then raise exception 'Over budget' using errcode='22023'; end if;
  if length(coalesce(p_payload->>'summary',''))>300 or jsonb_typeof(p_payload->'assumptions') is distinct from 'array' or jsonb_array_length(p_payload->'assumptions')>8
   or length(coalesce(p_payload->>'model',''))>100 or p_payload->>'provider' not in ('groq','gemini') then raise exception 'Invalid proposal metadata' using errcode='22023'; end if;
  update public.plan_proposals set status='ready',plan=candidate,summary=p_payload->>'summary',assumptions=p_payload->'assumptions',
   provider=p_payload->>'provider',model=p_payload->>'model',attempts=(p_payload->>'attempts')::integer where id=p_id returning * into proposal;
 elsif p_action='discard' then
  if proposal.status='discarded' then return private.proposal_json(proposal); end if;
  if proposal.status not in ('ready','failed','running') then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  update public.plan_proposals set status='discarded' where id=p_id returning * into proposal;
 elsif p_action='apply' then
  if proposal.status='applied' then return private.proposal_json(proposal); end if;
  if proposal.status<>'ready' or proposal.plan is null then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  if current_revision<>proposal.base_revision then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,p_id);
  update public.plan_proposals set status='applied',applied_revision=current_revision+1 where id=p_id returning * into proposal;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then return private.proposal_json(proposal); end if;
  if proposal.status<>'applied' or current_revision<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
  if exists(select 1 from public.plan_proposals p where p.event_id=p_event and p.status='applied' and p.applied_revision>proposal.applied_revision) then raise exception 'Only latest revision can roll back' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.before_plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,md5(p_id::text||':rollback')::uuid);
  update public.plan_proposals set status='rolled_back' where id=p_id returning * into proposal;
 else raise exception 'Invalid proposal action' using errcode='22023';
 end if;
 return private.proposal_json(proposal);
end $$;

create function public.plan_proposal_action(p_action text,p_event uuid,p_id uuid,p_expected integer,p_payload jsonb default '{}')
returns jsonb language sql volatile security invoker set search_path='' as $$
 select private.plan_proposal_action(p_action,p_event,p_id,p_expected,p_payload)
$$;
revoke all on function private.plan_proposal_action(text,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function private.plan_proposal_action(text,uuid,uuid,integer,jsonb) to authenticated;
revoke all on function public.plan_proposal_action(text,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.plan_proposal_action(text,uuid,uuid,integer,jsonb) to authenticated;


-- Source: 20261025192202_preserve_initial_plan_groups.sql
-- SHA-256 of normalized source: 3b415beace669d2da3ce0543ab71582f95c3edb985b6dba1861d36e5220262df
create or replace function private.plan_proposal_action(p_action text,p_event uuid,p_id uuid,p_expected integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proposal public.plan_proposals%rowtype; current_plan jsonb; candidate jsonb; result jsonb;
 current_revision integer; total_cost bigint; day_start timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_event is null or p_action is null then raise exception 'Invalid request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into current_revision from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 -- Leases do not permit an abandoned request to block an event indefinitely.
 update public.plan_proposals set status='failed' where event_id=p_event and owner_id=auth.uid() and status='running' and lease_until<now();
 if p_action='list' then
  select coalesce(jsonb_agg(private.proposal_json(s.p) order by (s.p).created_at desc),'[]'::jsonb) into result
   from (select p from public.plan_proposals p where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) s;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from public.plan_proposals where id=p_id;
 if found and (proposal.owner_id<>auth.uid() or proposal.event_id<>p_event) then raise exception 'Proposal not found' using errcode='P0002'; end if;

 if p_action='reserve' then
  if found then
   if proposal.base_revision<>p_expected or proposal.cache_key<>coalesce(p_payload->>'cacheKey','') then raise exception 'Operation conflict' using errcode='40001'; end if;
   -- Never hand a second worker a live lease with the same operation ID.
   if proposal.status='running' then raise exception 'Generation busy' using errcode='P1002'; end if;
   return private.proposal_json(proposal);
  end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  if jsonb_array_length(current_plan->'tasks')+jsonb_array_length(current_plan->'budget')+
    jsonb_array_length(current_plan->'resources')+jsonb_array_length(current_plan->'agenda')<>0 then
   raise exception 'Initial generation requires empty event' using errcode='P1003';
  end if;
  select * into proposal from public.plan_proposals where event_id=p_event and owner_id=auth.uid()
   and base_revision=p_expected and cache_key=p_payload->>'cacheKey' and status='ready' order by created_at desc limit 1;
  if found then return private.proposal_json(proposal); end if;
  if exists(select 1 from public.plan_proposals where event_id=p_event and status='running' and lease_until>=now()) then raise exception 'Generation busy' using errcode='P1002'; end if;
  -- Serialize daily counters across events and users, before a provider is contacted.
  perform pg_advisory_xact_lock(hashtextextended('gatherai:daily-ai-quota',0));
  day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from public.plan_proposals where owner_id=auth.uid() and created_at>=day_start)>=5
   or (select count(*) from public.plan_proposals where created_at>=day_start)>=20 then
   raise exception 'Daily AI limit' using errcode='P1001';
  end if;
  insert into public.plan_proposals(id,event_id,owner_id,base_revision,status,cache_key,before_plan)
   values(p_id,p_event,auth.uid(),p_expected,'running',p_payload->>'cacheKey',current_plan) returning * into proposal;
  return private.proposal_json(proposal);
 end if;

 if proposal.id is null then raise exception 'Proposal not found' using errcode='P0002'; end if;
 if proposal.base_revision<>p_expected then raise exception 'Invalid base revision' using errcode='40001'; end if;
 if p_action='fail' then
  update public.plan_proposals set status='failed' where id=p_id and status='running' returning * into proposal;
  return '{}'::jsonb;
 elsif p_action='complete' then
  if proposal.status<>'running' or proposal.lease_until<now() then raise exception 'Expired generation' using errcode='P1002'; end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=p_payload->'plan';
  if candidate is null or octet_length(candidate::text)>262144
   or (candidate-array['groups','tasks','budget','resources','agenda']) is distinct from
     (proposal.before_plan-array['groups','tasks','budget','resources','agenda']) then raise exception 'Invalid generated plan' using errcode='22023'; end if;
  if jsonb_typeof(candidate->'groups') is distinct from 'array' or jsonb_typeof(candidate->'tasks') is distinct from 'array'
   or jsonb_typeof(candidate->'budget') is distinct from 'array' or jsonb_typeof(candidate->'resources') is distinct from 'array'
   or jsonb_typeof(candidate->'agenda') is distinct from 'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
  if jsonb_array_length(candidate->'groups') not between 1 and 50 or jsonb_array_length(candidate->'tasks') not between 1 and 20
   or jsonb_array_length(candidate->'budget')>10 or jsonb_array_length(candidate->'resources')>10
   or jsonb_array_length(candidate->'agenda')>10 then raise exception 'Invalid collection sizes' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(proposal.before_plan->'groups') old_group
   where not exists(select 1 from jsonb_array_elements(candidate->'groups') new_group where new_group=old_group)) then
   raise exception 'Existing groups must be preserved' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(candidate->'budget') b where (b->>'actual')::bigint<>0 or (b->>'committed')::boolean is not false or (b->>'estimate')::bigint<0)
   or exists(select 1 from jsonb_array_elements(candidate->'tasks') t where t->>'status'<>'To do') then raise exception 'Invalid generated state' using errcode='22023'; end if;
  select coalesce(sum((b->>'estimate')::bigint),0) into total_cost from jsonb_array_elements(candidate->'budget') b;
  if total_cost>least((current_plan->>'confirmed')::bigint,(current_plan->>'limit')::bigint) then raise exception 'Over budget' using errcode='22023'; end if;
  if length(coalesce(p_payload->>'summary',''))>300 or jsonb_typeof(p_payload->'assumptions') is distinct from 'array' or jsonb_array_length(p_payload->'assumptions')>8
   or length(coalesce(p_payload->>'model',''))>100 or p_payload->>'provider' not in ('groq','gemini') then raise exception 'Invalid proposal metadata' using errcode='22023'; end if;
  update public.plan_proposals set status='ready',plan=candidate,summary=p_payload->>'summary',assumptions=p_payload->'assumptions',
   provider=p_payload->>'provider',model=p_payload->>'model',attempts=(p_payload->>'attempts')::integer where id=p_id returning * into proposal;
 elsif p_action='discard' then
  if proposal.status='discarded' then return private.proposal_json(proposal); end if;
  if proposal.status not in ('ready','failed','running') then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  update public.plan_proposals set status='discarded' where id=p_id returning * into proposal;
 elsif p_action='apply' then
  if proposal.status='applied' then return private.proposal_json(proposal); end if;
  if proposal.status<>'ready' or proposal.plan is null then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  if current_revision<>proposal.base_revision then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,p_id);
  update public.plan_proposals set status='applied',applied_revision=current_revision+1 where id=p_id returning * into proposal;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then return private.proposal_json(proposal); end if;
  if proposal.status<>'applied' or current_revision<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
  if exists(select 1 from public.plan_proposals p where p.event_id=p_event and p.status='applied' and p.applied_revision>proposal.applied_revision) then raise exception 'Only latest revision can roll back' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.before_plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,md5(p_id::text||':rollback')::uuid);
  update public.plan_proposals set status='rolled_back' where id=p_id returning * into proposal;
 else raise exception 'Invalid proposal action' using errcode='22023';
 end if;
 return private.proposal_json(proposal);
end $$;


-- Source: 20261026200630_resource_sourcing_details.sql
-- SHA-256 of normalized source: cdfc51e1e52c0a1ed2e24d5d6d0909e366424d96f59acea4578404e785962126
alter table public.events add column sourcing jsonb not null default '{}'::jsonb check(jsonb_typeof(sourcing)='object' and octet_length(sourcing::text)<=512);
alter table public.resources add column details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and octet_length(details::text)<=8192);
CREATE OR REPLACE FUNCTION public.read_event_plan(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'id',e.id,'name',e.name,'description',e.description,'kind',e.kind,'date',e.date,
  'location',e.location,'guests',e.guests,'confirmed',e.confirmed,'pending',e.pending,
  'limit',e.spending_limit,'revision',e.revision,'color',e.color,'sourcing',e.sourcing,
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.position) from public.task_groups g where g.event_id=e.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'groupId',t.group_id,'title',t.title,'notes',t.notes,'owner',t.owner_label,'due',coalesce(t.due::text,''),'priority',t.priority,'status',t.status) order by t.position) from public.tasks t where t.event_id=e.id),'[]'::jsonb),
  'budget',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'estimate',b.estimate,'actual',b.actual,'committed',b.committed) order by b.position) from public.budget_items b where b.event_id=e.id),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'source',r.source,'status',r.status,'details',r.details) order by r.position) from public.resources r where r.event_id=e.id),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'time',left(a.time::text,5),'title',a.title,'owner',a.owner_label) order by a.position) from public.agenda_items a where a.event_id=e.id),'[]'::jsonb)
 ) from public.events e where e.id=p_event_id and e.owner_id=auth.uid()
$function$;
CREATE OR REPLACE FUNCTION private.write_event_plan(p_plan jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 if p_plan ? 'sourcing' and (jsonb_typeof(p_plan->'sourcing') is distinct from 'object' or octet_length((p_plan->'sourcing')::text)>512) then raise exception 'Invalid sourcing settings' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'resources') resource where resource ? 'details' and (jsonb_typeof(resource->'details') is distinct from 'object' or octet_length((resource->'details')::text)>8192)) then raise exception 'Invalid resource details' using errcode='22023'; end if;
 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color,sourcing)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color',coalesce(p_plan->'sourcing',(select e.sourcing from public.events e where e.id=event_id_value),'{}'::jsonb))
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,sourcing=excluded.sourcing,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position,details) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal,coalesce(value->'details',(select r.details from public.resources r where r.event_id=event_id_value and r.id=(value->>'id')::uuid),'{}'::jsonb))
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position,details=excluded.details;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $function$;


-- Source: 20261027134539_event_brief_details.sql
-- SHA-256 of normalized source: 74844bc10863add669e1da880536e6f23bce072b8b37899c1a31a8f27bf5ef1d
alter table public.events add column brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief)='object' and octet_length(brief::text)<=8192);
CREATE OR REPLACE FUNCTION public.read_event_plan(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'id',e.id,'name',e.name,'description',e.description,'kind',e.kind,'date',e.date,
  'location',e.location,'guests',e.guests,'confirmed',e.confirmed,'pending',e.pending,
  'limit',e.spending_limit,'revision',e.revision,'color',e.color,'sourcing',e.sourcing,'brief',e.brief,
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.position) from public.task_groups g where g.event_id=e.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'groupId',t.group_id,'title',t.title,'notes',t.notes,'owner',t.owner_label,'due',coalesce(t.due::text,''),'priority',t.priority,'status',t.status) order by t.position) from public.tasks t where t.event_id=e.id),'[]'::jsonb),
  'budget',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'estimate',b.estimate,'actual',b.actual,'committed',b.committed) order by b.position) from public.budget_items b where b.event_id=e.id),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'source',r.source,'status',r.status,'details',r.details) order by r.position) from public.resources r where r.event_id=e.id),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'time',left(a.time::text,5),'title',a.title,'owner',a.owner_label) order by a.position) from public.agenda_items a where a.event_id=e.id),'[]'::jsonb)
 ) from public.events e where e.id=p_event_id and e.owner_id=auth.uid()
$function$
;
CREATE OR REPLACE FUNCTION private.write_event_plan(p_plan jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 if p_plan ? 'sourcing' and (jsonb_typeof(p_plan->'sourcing') is distinct from 'object' or octet_length((p_plan->'sourcing')::text)>512) then raise exception 'Invalid sourcing settings' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'resources') resource where resource ? 'details' and (jsonb_typeof(resource->'details') is distinct from 'object' or octet_length((resource->'details')::text)>8192)) then raise exception 'Invalid resource details' using errcode='22023'; end if;
 if p_plan ? 'brief' and (jsonb_typeof(p_plan->'brief') is distinct from 'object' or octet_length((p_plan->'brief')::text)>8192) then raise exception 'Invalid event brief' using errcode='22023'; end if;
 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color,sourcing,brief)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color',coalesce(p_plan->'sourcing',(select e.sourcing from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce(p_plan->'brief',(select e.brief from public.events e where e.id=event_id_value),'{}'::jsonb))
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,sourcing=excluded.sourcing,brief=excluded.brief,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position,details) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal,coalesce(value->'details',(select r.details from public.resources r where r.event_id=event_id_value and r.id=(value->>'id')::uuid),'{}'::jsonb))
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position,details=excluded.details;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $function$
;


-- Source: 20261027140321_additive_plan_proposals.sql
-- SHA-256 of normalized source: ba475a5686e5156ee2731def8a248b5433596fe9bf2fd2b796633c1c708496b5
CREATE OR REPLACE FUNCTION private.plan_proposal_action(p_action text, p_event uuid, p_id uuid, p_expected integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.plan_proposals%rowtype; current_plan jsonb; candidate jsonb; result jsonb;
 current_revision integer; total_cost bigint; day_start timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_event is null or p_action is null then raise exception 'Invalid request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into current_revision from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 -- Leases do not permit an abandoned request to block an event indefinitely.
 update public.plan_proposals set status='failed' where event_id=p_event and owner_id=auth.uid() and status='running' and lease_until<now();
 if p_action='list' then
  select coalesce(jsonb_agg(private.proposal_json(s.p) order by (s.p).created_at desc),'[]'::jsonb) into result
   from (select p from public.plan_proposals p where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) s;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from public.plan_proposals where id=p_id;
 if found and (proposal.owner_id<>auth.uid() or proposal.event_id<>p_event) then raise exception 'Proposal not found' using errcode='P0002'; end if;

 if p_action='reserve' then
  if found then
   if proposal.base_revision<>p_expected or proposal.cache_key<>coalesce(p_payload->>'cacheKey','') then raise exception 'Operation conflict' using errcode='40001'; end if;
   -- Never hand a second worker a live lease with the same operation ID.
   if proposal.status='running' then raise exception 'Generation busy' using errcode='P1002'; end if;
   return private.proposal_json(proposal);
  end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  select * into proposal from public.plan_proposals where event_id=p_event and owner_id=auth.uid()
   and base_revision=p_expected and cache_key=p_payload->>'cacheKey' and status='ready' order by created_at desc limit 1;
  if found then return private.proposal_json(proposal); end if;
  if exists(select 1 from public.plan_proposals where event_id=p_event and status='running' and lease_until>=now()) then raise exception 'Generation busy' using errcode='P1002'; end if;
  -- Serialize daily counters across events and users, before a provider is contacted.
  perform pg_advisory_xact_lock(hashtextextended('gatherai:daily-ai-quota',0));
  day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from public.plan_proposals where owner_id=auth.uid() and created_at>=day_start)>=5
   or (select count(*) from public.plan_proposals where created_at>=day_start)>=20 then
   raise exception 'Daily AI limit' using errcode='P1001';
  end if;
  insert into public.plan_proposals(id,event_id,owner_id,base_revision,status,cache_key,before_plan)
   values(p_id,p_event,auth.uid(),p_expected,'running',p_payload->>'cacheKey',current_plan) returning * into proposal;
  return private.proposal_json(proposal);
 end if;

 if proposal.id is null then raise exception 'Proposal not found' using errcode='P0002'; end if;
 if proposal.base_revision<>p_expected then raise exception 'Invalid base revision' using errcode='40001'; end if;
 if p_action='fail' then
  update public.plan_proposals set status='failed' where id=p_id and status='running' returning * into proposal;
  return '{}'::jsonb;
 elsif p_action='complete' then
  if proposal.status<>'running' or proposal.lease_until<now() then raise exception 'Expired generation' using errcode='P1002'; end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=p_payload->'plan';
  if candidate is null or octet_length(candidate::text)>262144
   or (candidate-array['groups','tasks','budget','resources','agenda']) is distinct from
     (proposal.before_plan-array['groups','tasks','budget','resources','agenda']) then raise exception 'Invalid generated plan' using errcode='22023'; end if;
  if jsonb_typeof(candidate->'groups') is distinct from 'array' or jsonb_typeof(candidate->'tasks') is distinct from 'array'
   or jsonb_typeof(candidate->'budget') is distinct from 'array' or jsonb_typeof(candidate->'resources') is distinct from 'array'
   or jsonb_typeof(candidate->'agenda') is distinct from 'array' then raise exception 'Invalid collections' using errcode='22023'; end if;

  if jsonb_array_length(candidate->'groups')>50 or jsonb_array_length(candidate->'tasks')>500
   or jsonb_array_length(candidate->'budget')>100 or jsonb_array_length(candidate->'resources')>100
   or jsonb_array_length(candidate->'agenda')>100
   or jsonb_array_length(candidate->'groups')>jsonb_array_length(proposal.before_plan->'groups')+5
   or jsonb_array_length(candidate->'tasks')>jsonb_array_length(proposal.before_plan->'tasks')+20
   or jsonb_array_length(candidate->'budget')>jsonb_array_length(proposal.before_plan->'budget')+10
   or jsonb_array_length(candidate->'resources')>jsonb_array_length(proposal.before_plan->'resources')+10
   or jsonb_array_length(candidate->'agenda')>jsonb_array_length(proposal.before_plan->'agenda')+10
   then raise exception 'Invalid collection sizes' using errcode='22023'; end if;
  -- Exact ordered prefixes protect all pre-existing entities and their fields.
  if exists(select 1 from unnest(array['groups','tasks','budget','resources','agenda']) as keys(k)
   cross join lateral jsonb_array_elements(proposal.before_plan->keys.k) with ordinality old_item(value,n)
   where candidate->keys.k->((old_item.n-1)::integer) is distinct from old_item.value) then
   raise exception 'Existing items must be preserved' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(candidate->'budget') with ordinality as items(b,n)
   where n>jsonb_array_length(proposal.before_plan->'budget') and ((b->>'actual')::bigint<>0 or (b->>'committed')::boolean is not false or (b->>'estimate')::bigint<0))
   or exists(select 1 from jsonb_array_elements(candidate->'tasks') with ordinality as items(t,n)
   where n>jsonb_array_length(proposal.before_plan->'tasks') and (t->>'status'<>'To do' or coalesce(t->>'owner','')<>''))
   or exists(select 1 from jsonb_array_elements(candidate->'resources') with ordinality as items(r,n)
   where n>jsonb_array_length(proposal.before_plan->'resources') and r->>'status'<>'Needed')
   or exists(select 1 from jsonb_array_elements(candidate->'agenda') with ordinality as items(a,n)
   where n>jsonb_array_length(proposal.before_plan->'agenda') and coalesce(a->>'owner','')<>'')
   then raise exception 'Invalid generated state' using errcode='22023'; end if;
  select coalesce(sum(greatest((b->>'estimate')::bigint,(b->>'actual')::bigint)),0)
   into total_cost from jsonb_array_elements(candidate->'budget') b;
  if total_cost>greatest(least((current_plan->>'confirmed')::bigint,(current_plan->>'limit')::bigint),
   (select coalesce(sum(greatest((b->>'estimate')::bigint,(b->>'actual')::bigint)),0) from jsonb_array_elements(proposal.before_plan->'budget') b))
   then raise exception 'Over budget' using errcode='22023'; end if;
  if length(coalesce(p_payload->>'summary',''))>300 or jsonb_typeof(p_payload->'assumptions') is distinct from 'array' or jsonb_array_length(p_payload->'assumptions')>8
   or length(coalesce(p_payload->>'model',''))>100 or p_payload->>'provider' not in ('groq','gemini') then raise exception 'Invalid proposal metadata' using errcode='22023'; end if;
  update public.plan_proposals set status='ready',plan=candidate,summary=p_payload->>'summary',assumptions=p_payload->'assumptions',
   provider=p_payload->>'provider',model=p_payload->>'model',attempts=(p_payload->>'attempts')::integer where id=p_id returning * into proposal;
 elsif p_action='discard' then
  if proposal.status='discarded' then return private.proposal_json(proposal); end if;
  if proposal.status not in ('ready','failed','running') then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  update public.plan_proposals set status='discarded' where id=p_id returning * into proposal;
 elsif p_action='apply' then
  if proposal.status='applied' then return private.proposal_json(proposal); end if;
  if proposal.status<>'ready' or proposal.plan is null then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  if current_revision<>proposal.base_revision then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,p_id);
  update public.plan_proposals set status='applied',applied_revision=current_revision+1 where id=p_id returning * into proposal;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then return private.proposal_json(proposal); end if;
  if proposal.status<>'applied' or current_revision<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
  if exists(select 1 from public.plan_proposals p where p.event_id=p_event and p.status='applied' and p.applied_revision>proposal.applied_revision) then raise exception 'Only latest revision can roll back' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.before_plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,md5(p_id::text||':rollback')::uuid);
  update public.plan_proposals set status='rolled_back' where id=p_id returning * into proposal;
 else raise exception 'Invalid proposal action' using errcode='22023';
 end if;
 return private.proposal_json(proposal);
end $function$
;


-- Source: 20261027140424_protect_additive_proposal_ids.sql
-- SHA-256 of normalized source: 6aa9f05b034f43cea634fcaeab76b064b9f9e600a502b642acf43704912fe797
CREATE OR REPLACE FUNCTION private.plan_proposal_action(p_action text, p_event uuid, p_id uuid, p_expected integer, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal public.plan_proposals%rowtype; current_plan jsonb; candidate jsonb; result jsonb;
 current_revision integer; total_cost bigint; day_start timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_event is null or p_action is null then raise exception 'Invalid request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into current_revision from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 -- Leases do not permit an abandoned request to block an event indefinitely.
 update public.plan_proposals set status='failed' where event_id=p_event and owner_id=auth.uid() and status='running' and lease_until<now();
 if p_action='list' then
  select coalesce(jsonb_agg(private.proposal_json(s.p) order by (s.p).created_at desc),'[]'::jsonb) into result
   from (select p from public.plan_proposals p where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) s;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from public.plan_proposals where id=p_id;
 if found and (proposal.owner_id<>auth.uid() or proposal.event_id<>p_event) then raise exception 'Proposal not found' using errcode='P0002'; end if;

 if p_action='reserve' then
  if found then
   if proposal.base_revision<>p_expected or proposal.cache_key<>coalesce(p_payload->>'cacheKey','') then raise exception 'Operation conflict' using errcode='40001'; end if;
   -- Never hand a second worker a live lease with the same operation ID.
   if proposal.status='running' then raise exception 'Generation busy' using errcode='P1002'; end if;
   return private.proposal_json(proposal);
  end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  select * into proposal from public.plan_proposals where event_id=p_event and owner_id=auth.uid()
   and base_revision=p_expected and cache_key=p_payload->>'cacheKey' and status='ready' order by created_at desc limit 1;
  if found then return private.proposal_json(proposal); end if;
  if exists(select 1 from public.plan_proposals where event_id=p_event and status='running' and lease_until>=now()) then raise exception 'Generation busy' using errcode='P1002'; end if;
  -- Serialize daily counters across events and users, before a provider is contacted.
  perform pg_advisory_xact_lock(hashtextextended('gatherai:daily-ai-quota',0));
  day_start:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
  if (select count(*) from public.plan_proposals where owner_id=auth.uid() and created_at>=day_start)>=5
   or (select count(*) from public.plan_proposals where created_at>=day_start)>=20 then
   raise exception 'Daily AI limit' using errcode='P1001';
  end if;
  insert into public.plan_proposals(id,event_id,owner_id,base_revision,status,cache_key,before_plan)
   values(p_id,p_event,auth.uid(),p_expected,'running',p_payload->>'cacheKey',current_plan) returning * into proposal;
  return private.proposal_json(proposal);
 end if;

 if proposal.id is null then raise exception 'Proposal not found' using errcode='P0002'; end if;
 if proposal.base_revision<>p_expected then raise exception 'Invalid base revision' using errcode='40001'; end if;
 if p_action='fail' then
  update public.plan_proposals set status='failed' where id=p_id and status='running' returning * into proposal;
  return '{}'::jsonb;
 elsif p_action='complete' then
  if proposal.status<>'running' or proposal.lease_until<now() then raise exception 'Expired generation' using errcode='P1002'; end if;
  if current_revision<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=p_payload->'plan';
  if candidate is null or octet_length(candidate::text)>262144
   or (candidate-array['groups','tasks','budget','resources','agenda']) is distinct from
     (proposal.before_plan-array['groups','tasks','budget','resources','agenda']) then raise exception 'Invalid generated plan' using errcode='22023'; end if;
  if jsonb_typeof(candidate->'groups') is distinct from 'array' or jsonb_typeof(candidate->'tasks') is distinct from 'array'
   or jsonb_typeof(candidate->'budget') is distinct from 'array' or jsonb_typeof(candidate->'resources') is distinct from 'array'
   or jsonb_typeof(candidate->'agenda') is distinct from 'array' then raise exception 'Invalid collections' using errcode='22023'; end if;

  if jsonb_array_length(candidate->'groups')>50 or jsonb_array_length(candidate->'tasks')>500
   or jsonb_array_length(candidate->'budget')>100 or jsonb_array_length(candidate->'resources')>100
   or jsonb_array_length(candidate->'agenda')>100
   or jsonb_array_length(candidate->'groups')>jsonb_array_length(proposal.before_plan->'groups')+5
   or jsonb_array_length(candidate->'tasks')>jsonb_array_length(proposal.before_plan->'tasks')+20
   or jsonb_array_length(candidate->'budget')>jsonb_array_length(proposal.before_plan->'budget')+10
   or jsonb_array_length(candidate->'resources')>jsonb_array_length(proposal.before_plan->'resources')+10
   or jsonb_array_length(candidate->'agenda')>jsonb_array_length(proposal.before_plan->'agenda')+10
   then raise exception 'Invalid collection sizes' using errcode='22023'; end if;
  -- Exact ordered prefixes protect all pre-existing entities and their fields.
  if exists(select 1 from unnest(array['groups','tasks','budget','resources','agenda']) as keys(k)
   cross join lateral jsonb_array_elements(proposal.before_plan->keys.k) with ordinality old_item(value,n)
   where candidate->keys.k->((old_item.n-1)::integer) is distinct from old_item.value) then
   raise exception 'Existing items must be preserved' using errcode='22023';
  end if;
  if exists(select 1 from unnest(array['groups','tasks','budget','resources','agenda']) as keys(k)
   cross join lateral jsonb_array_elements(candidate->keys.k) item
   group by item->>'id' having item->>'id' is null or count(*)>1) then
   raise exception 'Duplicate or missing entity ID' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(candidate->'budget') with ordinality as items(b,n)
   where n>jsonb_array_length(proposal.before_plan->'budget') and ((b->>'actual')::bigint is distinct from 0 or (b->>'committed')::boolean is not false or ((b->>'estimate')::bigint is null or (b->>'estimate')::bigint<0)))
   or exists(select 1 from jsonb_array_elements(candidate->'tasks') with ordinality as items(t,n)
   where n>jsonb_array_length(proposal.before_plan->'tasks') and (t->>'status' is distinct from 'To do' or coalesce(t->>'owner','')<>''))
   or exists(select 1 from jsonb_array_elements(candidate->'resources') with ordinality as items(r,n)
   where n>jsonb_array_length(proposal.before_plan->'resources') and r->>'status' is distinct from 'Needed')
   or exists(select 1 from jsonb_array_elements(candidate->'agenda') with ordinality as items(a,n)
   where n>jsonb_array_length(proposal.before_plan->'agenda') and coalesce(a->>'owner','')<>'')
   then raise exception 'Invalid generated state' using errcode='22023'; end if;
  select coalesce(sum(greatest((b->>'estimate')::bigint,(b->>'actual')::bigint)),0)
   into total_cost from jsonb_array_elements(candidate->'budget') b;
  if total_cost>greatest(least((current_plan->>'confirmed')::bigint,(current_plan->>'limit')::bigint),
   (select coalesce(sum(greatest((b->>'estimate')::bigint,(b->>'actual')::bigint)),0) from jsonb_array_elements(proposal.before_plan->'budget') b))
   then raise exception 'Over budget' using errcode='22023'; end if;
  if length(coalesce(p_payload->>'summary',''))>300 or jsonb_typeof(p_payload->'assumptions') is distinct from 'array' or jsonb_array_length(p_payload->'assumptions')>8
   or length(coalesce(p_payload->>'model',''))>100 or p_payload->>'provider' not in ('groq','gemini') then raise exception 'Invalid proposal metadata' using errcode='22023'; end if;
  update public.plan_proposals set status='ready',plan=candidate,summary=p_payload->>'summary',assumptions=p_payload->'assumptions',
   provider=p_payload->>'provider',model=p_payload->>'model',attempts=(p_payload->>'attempts')::integer where id=p_id returning * into proposal;
 elsif p_action='discard' then
  if proposal.status='discarded' then return private.proposal_json(proposal); end if;
  if proposal.status not in ('ready','failed','running') then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  update public.plan_proposals set status='discarded' where id=p_id returning * into proposal;
 elsif p_action='apply' then
  if proposal.status='applied' then return private.proposal_json(proposal); end if;
  if proposal.status<>'ready' or proposal.plan is null then raise exception 'Proposal state conflict' using errcode='40001'; end if;
  if current_revision<>proposal.base_revision then raise exception 'Stale revision' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,p_id);
  update public.plan_proposals set status='applied',applied_revision=current_revision+1 where id=p_id returning * into proposal;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then return private.proposal_json(proposal); end if;
  if proposal.status<>'applied' or current_revision<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
  if exists(select 1 from public.plan_proposals p where p.event_id=p_event and p.status='applied' and p.applied_revision>proposal.applied_revision) then raise exception 'Only latest revision can roll back' using errcode='40001'; end if;
  candidate:=jsonb_set(proposal.before_plan,'{revision}',to_jsonb(current_revision+1));
  perform private.write_event_plan(candidate,current_revision,md5(p_id::text||':rollback')::uuid);
  update public.plan_proposals set status='rolled_back' where id=p_id returning * into proposal;
 else raise exception 'Invalid proposal action' using errcode='22023';
 end if;
 return private.proposal_json(proposal);
end $function$
;


-- Source: 20261027142125_reviewed_funding_proposals.sql
-- SHA-256 of normalized source: fc30fd7a7fc13f87b854978b0aae140bc91d01c147ca8da3c93acc2f927d3eb7
create table private.funding_proposals (
 id uuid primary key, event_id uuid not null references public.events(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 base_revision integer not null, old_confirmed bigint not null, old_limit bigint not null,
 new_confirmed bigint not null check(new_confirmed between 0 and 1000000000),
 new_limit bigint not null check(new_limit between 0 and 1000000000),
 status text not null check(status in ('ready','applied','discarded','rolled_back')),
 applied_revision integer, created_at timestamptz not null default now()
);
alter table private.funding_proposals enable row level security;
revoke all on private.funding_proposals from public, anon, authenticated;
create or replace function private.funding_proposal_action(p_action text,p_event uuid,p_id uuid,p_expected integer,p_confirmed bigint,p_limit bigint)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare proposal private.funding_proposals%rowtype; current_plan jsonb; rev integer; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into rev from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into result
   from (select id,event_id,base_revision,old_confirmed,old_limit,new_confirmed,new_limit,status,applied_revision,created_at from private.funding_proposals where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) x;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from private.funding_proposals where id=p_id;
 if found and (proposal.event_id<>p_event or proposal.owner_id<>auth.uid()) then raise exception 'Not found' using errcode='P0002'; end if;
 if p_action='create' then
  if found then
   if proposal.base_revision<>p_expected or proposal.new_confirmed is distinct from p_confirmed or proposal.new_limit is distinct from p_limit then raise exception 'Operation conflict' using errcode='40001'; end if;
  else
   if rev<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
   if p_confirmed is null or p_limit is null or p_confirmed not between 0 and 1000000000 or p_limit not between 0 and 1000000000 then raise exception 'Invalid funds' using errcode='22023'; end if;
   insert into private.funding_proposals(id,event_id,owner_id,base_revision,old_confirmed,old_limit,new_confirmed,new_limit,status)
   values(p_id,p_event,auth.uid(),rev,(current_plan->>'confirmed')::bigint,(current_plan->>'limit')::bigint,p_confirmed,p_limit,'ready') returning * into proposal;
  end if;
 elsif proposal.id is null then raise exception 'Proposal not found' using errcode='P0002';
 elsif p_action='discard' then
  if proposal.status='discarded' then null;
  elsif proposal.status='ready' then update private.funding_proposals set status='discarded' where id=p_id returning * into proposal;
  else raise exception 'Proposal state conflict' using errcode='40001'; end if;
 elsif p_action='apply' then
  if proposal.status='applied' then null;
  else
   if proposal.status<>'ready' or rev<>proposal.base_revision or p_expected<>proposal.base_revision then raise exception 'Stale proposal' using errcode='40001'; end if;
   current_plan:=jsonb_set(jsonb_set(jsonb_set(current_plan,'{confirmed}',to_jsonb(proposal.new_confirmed)),'{limit}',to_jsonb(proposal.new_limit)),'{revision}',to_jsonb(rev+1));
   perform private.write_event_plan(current_plan,rev,p_id);
   update private.funding_proposals set status='applied',applied_revision=rev+1 where id=p_id returning * into proposal;
  end if;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then null;
  else
   if proposal.status<>'applied' or rev<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
   current_plan:=jsonb_set(jsonb_set(jsonb_set(current_plan,'{confirmed}',to_jsonb(proposal.old_confirmed)),'{limit}',to_jsonb(proposal.old_limit)),'{revision}',to_jsonb(rev+1));
   perform private.write_event_plan(current_plan,rev,md5(p_id::text||':funding-rollback')::uuid);
   update private.funding_proposals set status='rolled_back' where id=p_id returning * into proposal;
  end if;
 else raise exception 'Invalid action' using errcode='22023';
 end if;
 return to_jsonb(proposal)-'owner_id';
end $function$;
revoke all on function private.funding_proposal_action(text,uuid,uuid,integer,bigint,bigint) from public,anon;
grant execute on function private.funding_proposal_action(text,uuid,uuid,integer,bigint,bigint) to authenticated;
create or replace function public.funding_proposal_action(p_action text,p_event uuid,p_id uuid default null,p_expected integer default null,p_confirmed bigint default null,p_limit bigint default null)
returns jsonb language sql set search_path='' as $function$
 select private.funding_proposal_action(p_action,p_event,p_id,p_expected,p_confirmed,p_limit)
$function$;
revoke all on function public.funding_proposal_action(text,uuid,uuid,integer,bigint,bigint) from public,anon;
grant execute on function public.funding_proposal_action(text,uuid,uuid,integer,bigint,bigint) to authenticated;


-- Source: 20261027142912_event_archive_state.sql
-- SHA-256 of normalized source: 04fc5a2af8b05395967f09e9bd99545f5d98dab5dd52f96ec314781a036c9977
alter table public.events add column archived boolean not null default false;
CREATE OR REPLACE FUNCTION public.read_event_plan(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'id',e.id,'name',e.name,'description',e.description,'kind',e.kind,'date',e.date,
  'location',e.location,'guests',e.guests,'confirmed',e.confirmed,'pending',e.pending,
  'limit',e.spending_limit,'revision',e.revision,'color',e.color,'sourcing',e.sourcing,'brief',e.brief,'archived',e.archived,
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.position) from public.task_groups g where g.event_id=e.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'groupId',t.group_id,'title',t.title,'notes',t.notes,'owner',t.owner_label,'due',coalesce(t.due::text,''),'priority',t.priority,'status',t.status) order by t.position) from public.tasks t where t.event_id=e.id),'[]'::jsonb),
  'budget',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'estimate',b.estimate,'actual',b.actual,'committed',b.committed) order by b.position) from public.budget_items b where b.event_id=e.id),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'source',r.source,'status',r.status,'details',r.details) order by r.position) from public.resources r where r.event_id=e.id),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'time',left(a.time::text,5),'title',a.title,'owner',a.owner_label) order by a.position) from public.agenda_items a where a.event_id=e.id),'[]'::jsonb)
 ) from public.events e where e.id=p_event_id and e.owner_id=auth.uid()
$function$
;
CREATE OR REPLACE FUNCTION private.write_event_plan(p_plan jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 if p_plan ? 'sourcing' and (jsonb_typeof(p_plan->'sourcing') is distinct from 'object' or octet_length((p_plan->'sourcing')::text)>512) then raise exception 'Invalid sourcing settings' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'resources') resource where resource ? 'details' and (jsonb_typeof(resource->'details') is distinct from 'object' or octet_length((resource->'details')::text)>8192)) then raise exception 'Invalid resource details' using errcode='22023'; end if;
 if p_plan ? 'brief' and (jsonb_typeof(p_plan->'brief') is distinct from 'object' or octet_length((p_plan->'brief')::text)>8192) then raise exception 'Invalid event brief' using errcode='22023'; end if;
 if p_plan ? 'archived' and jsonb_typeof(p_plan->'archived') is distinct from 'boolean' then raise exception 'Invalid archive state' using errcode='22023'; end if;
 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color,sourcing,brief,archived)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color',coalesce(p_plan->'sourcing',(select e.sourcing from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce(p_plan->'brief',(select e.brief from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce((p_plan->>'archived')::boolean,(select e.archived from public.events e where e.id=event_id_value),false))
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,sourcing=excluded.sourcing,brief=excluded.brief,archived=excluded.archived,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position,details) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal,coalesce(value->'details',(select r.details from public.resources r where r.event_id=event_id_value and r.id=(value->>'id')::uuid),'{}'::jsonb))
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position,details=excluded.details;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $function$
;


-- Source: 20261027143514_task_prerequisites.sql
-- SHA-256 of normalized source: a0979670e826a58b17a0a26729e34240e7b63a162768faeb40064506585aceb1
alter table public.tasks add column depends_on uuid;
CREATE OR REPLACE FUNCTION public.read_event_plan(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'id',e.id,'name',e.name,'description',e.description,'kind',e.kind,'date',e.date,
  'location',e.location,'guests',e.guests,'confirmed',e.confirmed,'pending',e.pending,
  'limit',e.spending_limit,'revision',e.revision,'color',e.color,'sourcing',e.sourcing,'brief',e.brief,'archived',e.archived,
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.position) from public.task_groups g where g.event_id=e.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'groupId',t.group_id,'title',t.title,'notes',t.notes,'owner',t.owner_label,'due',coalesce(t.due::text,''),'priority',t.priority,'status',t.status,'dependsOn',t.depends_on) order by t.position) from public.tasks t where t.event_id=e.id),'[]'::jsonb),
  'budget',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'estimate',b.estimate,'actual',b.actual,'committed',b.committed) order by b.position) from public.budget_items b where b.event_id=e.id),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'source',r.source,'status',r.status,'details',r.details) order by r.position) from public.resources r where r.event_id=e.id),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'time',left(a.time::text,5),'title',a.title,'owner',a.owner_label) order by a.position) from public.agenda_items a where a.event_id=e.id),'[]'::jsonb)
 ) from public.events e where e.id=p_event_id and e.owner_id=auth.uid()
$function$
;
CREATE OR REPLACE FUNCTION private.write_event_plan(p_plan jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 if p_plan ? 'sourcing' and (jsonb_typeof(p_plan->'sourcing') is distinct from 'object' or octet_length((p_plan->'sourcing')::text)>512) then raise exception 'Invalid sourcing settings' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'resources') resource where resource ? 'details' and (jsonb_typeof(resource->'details') is distinct from 'object' or octet_length((resource->'details')::text)>8192)) then raise exception 'Invalid resource details' using errcode='22023'; end if;
 if p_plan ? 'brief' and (jsonb_typeof(p_plan->'brief') is distinct from 'object' or octet_length((p_plan->'brief')::text)>8192) then raise exception 'Invalid event brief' using errcode='22023'; end if;
 if p_plan ? 'archived' and jsonb_typeof(p_plan->'archived') is distinct from 'boolean' then raise exception 'Invalid archive state' using errcode='22023'; end if;

 -- Validate effective dependency links, including links omitted by older clients.
 if exists(with links as (
  select (j->>'id')::uuid as id,
   case when j ? 'dependsOn' then nullif(j->>'dependsOn','')::uuid
    else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(j->>'id')::uuid) end as dep
  from jsonb_array_elements(p_plan->'tasks') j
 ) select 1 from links l where l.dep is not null and not exists(select 1 from links target where target.id=l.dep))
 then raise exception 'Dependency must reference a task in this event' using errcode='22023'; end if;
 if exists(with recursive links as (
  select (j->>'id')::uuid as id,
   case when j ? 'dependsOn' then nullif(j->>'dependsOn','')::uuid
    else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(j->>'id')::uuid) end as dep
  from jsonb_array_elements(p_plan->'tasks') j
 ), paths(start_id,id) as (
  select id,dep from links where dep is not null
  union select paths.start_id,links.dep from paths join links on links.id=paths.id where links.dep is not null
 ) select 1 from paths where start_id=id)
 then raise exception 'Task dependency cycle' using errcode='22023'; end if;
 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color,sourcing,brief,archived)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color',coalesce(p_plan->'sourcing',(select e.sourcing from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce(p_plan->'brief',(select e.brief from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce((p_plan->>'archived')::boolean,(select e.archived from public.events e where e.id=event_id_value),false))
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,sourcing=excluded.sourcing,brief=excluded.brief,archived=excluded.archived,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position,depends_on)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal,case when value ? 'dependsOn' then nullif(value->>'dependsOn','')::uuid else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(value->>'id')::uuid) end)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position,depends_on=excluded.depends_on;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position,details) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal,coalesce(value->'details',(select r.details from public.resources r where r.event_id=event_id_value and r.id=(value->>'id')::uuid),'{}'::jsonb))
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position,details=excluded.details;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $function$
;


-- Source: 20261027143640_reviewed_event_changes.sql
-- SHA-256 of normalized source: a6b2e42095bd721b53ac5fa68a7e2040b52cfb1aeb956c2d0082438e891b0681
create table private.event_change_proposals (
 id uuid primary key, event_id uuid not null references public.events(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade, base_revision integer not null,
 kind text not null check(kind in ('date','attendance','venue')), value text not null,
 before_plan jsonb not null, proposed_plan jsonb not null,
 status text not null check(status in ('ready','applied','discarded','rolled_back')),
 applied_revision integer, created_at timestamptz not null default now()
);
alter table private.event_change_proposals enable row level security;
revoke all on private.event_change_proposals from public,anon,authenticated;
create or replace function private.event_change_action(p_action text,p_event uuid,p_id uuid,p_expected integer,p_kind text,p_value text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare proposal private.event_change_proposals%rowtype; current_plan jsonb; candidate jsonb; rev integer; event_date date; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into rev from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into result from
   (select id,event_id,base_revision,kind,value,status,applied_revision,before_plan,proposed_plan,created_at
    from private.event_change_proposals where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) x;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from private.event_change_proposals where id=p_id;
 if found and (proposal.event_id<>p_event or proposal.owner_id<>auth.uid()) then raise exception 'Not found' using errcode='P0002'; end if;
 if p_action='create' then
  if found then
   if proposal.base_revision<>p_expected or proposal.kind is distinct from p_kind or proposal.value is distinct from p_value then raise exception 'Operation conflict' using errcode='40001'; end if;
  else
   if rev<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
   candidate:=current_plan;
   if p_kind='attendance' then
    if p_value is null or p_value !~ '^[0-9]{1,6}$' or p_value::integer not between 1 and 100000 then raise exception 'Invalid attendance' using errcode='22023'; end if;
    candidate:=jsonb_set(candidate,'{guests}',to_jsonb(p_value::integer));
   elsif p_kind='date' then
    if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
    begin event_date:=p_value::date; exception when others then raise exception 'Invalid date' using errcode='22023'; end;
    if event_date<date '1900-01-01' or event_date>date '2199-12-31' then raise exception 'Invalid date' using errcode='22023'; end if;
    candidate:=jsonb_set(candidate,'{date}',to_jsonb(p_value));
   elsif p_kind='venue' then
    if p_value is null or length(trim(p_value)) not between 1 and 200 then raise exception 'Invalid venue' using errcode='22023'; end if;
    candidate:=jsonb_set(candidate,'{location}',to_jsonb(trim(p_value)));
   else raise exception 'Invalid change' using errcode='22023'; end if;
   if (p_kind='date' and p_value<>current_plan->>'date') or (p_kind='venue' and trim(p_value)<>current_plan->>'location') then
    select coalesce(jsonb_agg(case when item->>'status' in ('Confirmed','Requested')
      then jsonb_set(item,'{status}','"Reconfirmation needed"'::jsonb) else item end order by n),'[]'::jsonb)
      into result from jsonb_array_elements(current_plan->'resources') with ordinality as items(item,n);
    candidate:=jsonb_set(candidate,'{resources}',result);
   end if;
   insert into private.event_change_proposals(id,event_id,owner_id,base_revision,kind,value,before_plan,proposed_plan,status)
    values(p_id,p_event,auth.uid(),rev,p_kind,p_value,current_plan,candidate,'ready') returning * into proposal;
  end if;
 elsif proposal.id is null then raise exception 'Proposal not found' using errcode='P0002';
 elsif p_action='discard' then
  if proposal.status='discarded' then null;
  elsif proposal.status='ready' then update private.event_change_proposals set status='discarded' where id=p_id returning * into proposal;
  else raise exception 'Proposal conflict' using errcode='40001'; end if;
 elsif p_action='apply' then
  if proposal.status='applied' then null;
  else
   if proposal.status<>'ready' or rev<>proposal.base_revision or p_expected<>proposal.base_revision then raise exception 'Stale proposal' using errcode='40001'; end if;
   perform private.write_event_plan(jsonb_set(proposal.proposed_plan,'{revision}',to_jsonb(rev+1)),rev,p_id);
   update private.event_change_proposals set status='applied',applied_revision=rev+1 where id=p_id returning * into proposal;
  end if;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then null;
  else
   if proposal.status<>'applied' or rev<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
   perform private.write_event_plan(jsonb_set(proposal.before_plan,'{revision}',to_jsonb(rev+1)),rev,md5(p_id::text||':event-change-rollback')::uuid);
   update private.event_change_proposals set status='rolled_back' where id=p_id returning * into proposal;
  end if;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 return to_jsonb(proposal)-'owner_id';
end $function$;
revoke all on function private.event_change_action(text,uuid,uuid,integer,text,text) from public,anon;
grant execute on function private.event_change_action(text,uuid,uuid,integer,text,text) to authenticated;
create or replace function public.event_change_action(p_action text,p_event uuid,p_id uuid default null,p_expected integer default null,p_kind text default null,p_value text default null)
returns jsonb language sql set search_path='' as $function$
 select private.event_change_action(p_action,p_event,p_id,p_expected,p_kind,p_value)
$function$;
revoke all on function public.event_change_action(text,uuid,uuid,integer,text,text) from public,anon;
grant execute on function public.event_change_action(text,uuid,uuid,integer,text,text) to authenticated;


-- Source: 20261027144312_explicit_planning_metadata.sql
-- SHA-256 of normalized source: 610944d952c3e59584584b1f47f6d37333024e53b3b69e664c4ff0fe202e94a5
alter table public.events add column planning jsonb not null default '{"budget":[],"tasks":[]}'::jsonb check(jsonb_typeof(planning)='object' and octet_length(planning::text)<=65536);
CREATE OR REPLACE FUNCTION public.read_event_plan(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
  'id',e.id,'name',e.name,'description',e.description,'kind',e.kind,'date',e.date,
  'location',e.location,'guests',e.guests,'confirmed',e.confirmed,'pending',e.pending,
  'limit',e.spending_limit,'revision',e.revision,'color',e.color,'sourcing',e.sourcing,'brief',e.brief,'archived',e.archived,'planning',e.planning,
  'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.position) from public.task_groups g where g.event_id=e.id),'[]'::jsonb),
  'tasks',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'groupId',t.group_id,'title',t.title,'notes',t.notes,'owner',t.owner_label,'due',coalesce(t.due::text,''),'priority',t.priority,'status',t.status,'dependsOn',t.depends_on) order by t.position) from public.tasks t where t.event_id=e.id),'[]'::jsonb),
  'budget',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'category',b.category,'estimate',b.estimate,'actual',b.actual,'committed',b.committed) order by b.position) from public.budget_items b where b.event_id=e.id),'[]'::jsonb),
  'resources',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'source',r.source,'status',r.status,'details',r.details) order by r.position) from public.resources r where r.event_id=e.id),'[]'::jsonb),
  'agenda',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'time',left(a.time::text,5),'title',a.title,'owner',a.owner_label) order by a.position) from public.agenda_items a where a.event_id=e.id),'[]'::jsonb)
 ) from public.events e where e.id=p_event_id and e.owner_id=auth.uid()
$function$
;
CREATE OR REPLACE FUNCTION private.write_event_plan(p_plan jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb; planning_value jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 if p_plan ? 'sourcing' and (jsonb_typeof(p_plan->'sourcing') is distinct from 'object' or octet_length((p_plan->'sourcing')::text)>512) then raise exception 'Invalid sourcing settings' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'resources') resource where resource ? 'details' and (jsonb_typeof(resource->'details') is distinct from 'object' or octet_length((resource->'details')::text)>8192)) then raise exception 'Invalid resource details' using errcode='22023'; end if;
 if p_plan ? 'brief' and (jsonb_typeof(p_plan->'brief') is distinct from 'object' or octet_length((p_plan->'brief')::text)>8192) then raise exception 'Invalid event brief' using errcode='22023'; end if;
 if p_plan ? 'archived' and jsonb_typeof(p_plan->'archived') is distinct from 'boolean' then raise exception 'Invalid archive state' using errcode='22023'; end if;

 -- Validate effective dependency links, including links omitted by older clients.
 if exists(with links as (
  select (j->>'id')::uuid as id,
   case when j ? 'dependsOn' then nullif(j->>'dependsOn','')::uuid
    else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(j->>'id')::uuid) end as dep
  from jsonb_array_elements(p_plan->'tasks') j
 ) select 1 from links l where l.dep is not null and not exists(select 1 from links target where target.id=l.dep))
 then raise exception 'Dependency must reference a task in this event' using errcode='22023'; end if;
 if exists(with recursive links as (
  select (j->>'id')::uuid as id,
   case when j ? 'dependsOn' then nullif(j->>'dependsOn','')::uuid
    else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(j->>'id')::uuid) end as dep
  from jsonb_array_elements(p_plan->'tasks') j
 ), paths(start_id,id) as (
  select id,dep from links where dep is not null
  union select paths.start_id,links.dep from paths join links on links.id=paths.id where links.dep is not null
 ) select 1 from paths where start_id=id)
 then raise exception 'Task dependency cycle' using errcode='22023'; end if;

 planning_value:=coalesce(p_plan->'planning',(select e.planning from public.events e where e.id=event_id_value),'{"budget":[],"tasks":[]}'::jsonb);
 if jsonb_typeof(planning_value) is distinct from 'object' or octet_length(planning_value::text)>65536
  or jsonb_typeof(planning_value->'budget') is distinct from 'array'
  or jsonb_typeof(planning_value->'tasks') is distinct from 'array' then raise exception 'Invalid planning metadata' using errcode='22023'; end if;
 if planning_value ? 'capacity' and (coalesce(planning_value->>'capacity','') !~ '^[0-9]{1,6}$' or (planning_value->>'capacity')::integer not between 1 and 100000) then raise exception 'Invalid capacity' using errcode='22023'; end if;
 if jsonb_array_length(planning_value->'budget')>100 or jsonb_array_length(planning_value->'tasks')>500
  or exists(select 1 from jsonb_array_elements(planning_value->'budget') m where coalesce(m->>'id','')='' or coalesce(m->>'basis','') not in ('manual','fixed','per_attendee')
   or (m->>'basis'='per_attendee' and (coalesce(m->>'unitCost','') !~ '^[0-9]{1,10}$' or (m->>'unitCost')::bigint>1000000000))
   or not exists(select 1 from jsonb_array_elements(p_plan->'budget') b where b->>'id'=m->>'id'))
  or exists(select 1 from jsonb_array_elements(planning_value->'tasks') m where coalesce(m->>'id','')='' or coalesce(m->>'deadlineMode','') not in ('fixed','event_relative')
   or not exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where t->>'id'=m->>'id'))
  or exists(select 1 from jsonb_array_elements(planning_value->'budget') m group by m->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(planning_value->'tasks') m group by m->>'id' having count(*)>1)
 then raise exception 'Invalid planning references' using errcode='22023'; end if;

 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color,sourcing,brief,archived,planning)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color',coalesce(p_plan->'sourcing',(select e.sourcing from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce(p_plan->'brief',(select e.brief from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce((p_plan->>'archived')::boolean,(select e.archived from public.events e where e.id=event_id_value),false),planning_value)
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,sourcing=excluded.sourcing,brief=excluded.brief,archived=excluded.archived,planning=excluded.planning,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position,depends_on)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal,case when value ? 'dependsOn' then nullif(value->>'dependsOn','')::uuid else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(value->>'id')::uuid) end)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position,depends_on=excluded.depends_on;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position,details) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal,coalesce(value->'details',(select r.details from public.resources r where r.event_id=event_id_value and r.id=(value->>'id')::uuid),'{}'::jsonb))
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position,details=excluded.details;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $function$
;


-- Source: 20261027144418_apply_explicit_planning_rules.sql
-- SHA-256 of normalized source: e79782d697c899280d01761068c46c50765b8f24e92d1fb70f299184ddb9cf08
CREATE OR REPLACE FUNCTION private.event_change_action(p_action text, p_event uuid, p_id uuid, p_expected integer, p_kind text, p_value text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposal private.event_change_proposals%rowtype; current_plan jsonb; candidate jsonb; rev integer; event_date date; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
 select e.revision into rev from public.events e where e.id=p_event and e.owner_id=auth.uid();
 if not found then raise exception 'Event not found' using errcode='P0002'; end if;
 current_plan:=public.read_event_plan(p_event);
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into result from
   (select id,event_id,base_revision,kind,value,status,applied_revision,before_plan,proposed_plan,created_at
    from private.event_change_proposals where event_id=p_event and owner_id=auth.uid() order by created_at desc limit 10) x;
  return result;
 end if;
 if p_id is null or p_expected is null then raise exception 'Invalid request' using errcode='22023'; end if;
 select * into proposal from private.event_change_proposals where id=p_id;
 if found and (proposal.event_id<>p_event or proposal.owner_id<>auth.uid()) then raise exception 'Not found' using errcode='P0002'; end if;
 if p_action='create' then
  if found then
   if proposal.base_revision<>p_expected or proposal.kind is distinct from p_kind or proposal.value is distinct from p_value then raise exception 'Operation conflict' using errcode='40001'; end if;
  else
   if rev<>p_expected then raise exception 'Stale revision' using errcode='40001'; end if;
   candidate:=current_plan;
   if p_kind='attendance' then
    if p_value is null or p_value !~ '^[0-9]{1,6}$' or p_value::integer not between 1 and 100000 then raise exception 'Invalid attendance' using errcode='22023'; end if;
    candidate:=jsonb_set(candidate,'{guests}',to_jsonb(p_value::integer));
    if p_value::integer<>(current_plan->>'guests')::integer then
    if exists(select 1 from jsonb_array_elements(current_plan->'planning'->'budget') m
      join lateral jsonb_array_elements(current_plan->'budget') b on b->>'id'=m->>'id'
      where m->>'basis'='per_attendee' and (b->>'committed')::boolean is false
       and (m->>'unitCost')::bigint*p_value::integer>1000000000)
     then raise exception 'Scaled estimate too large' using errcode='22023'; end if;
    select coalesce(jsonb_agg(case when m->>'basis'='per_attendee' and (b->>'committed')::boolean is false
       then jsonb_set(b,'{estimate}',to_jsonb(greatest((b->>'actual')::bigint,(m->>'unitCost')::bigint*p_value::integer)))
       else b end order by n),'[]'::jsonb) into result
     from jsonb_array_elements(current_plan->'budget') with ordinality as items(b,n)
     left join lateral (select rule from jsonb_array_elements(current_plan->'planning'->'budget') rule where rule->>'id'=b->>'id') meta(m) on true;
    candidate:=jsonb_set(candidate,'{budget}',result);
    end if;
   elsif p_kind='date' then
    if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid date' using errcode='22023'; end if;
    begin event_date:=p_value::date; exception when others then raise exception 'Invalid date' using errcode='22023'; end;
    if event_date<date '1900-01-01' or event_date>date '2199-12-31' then raise exception 'Invalid date' using errcode='22023'; end if;
    candidate:=jsonb_set(candidate,'{date}',to_jsonb(p_value));
    if exists(select 1 from jsonb_array_elements(current_plan->'tasks') t
      join lateral jsonb_array_elements(current_plan->'planning'->'tasks') m on m->>'id'=t->>'id'
      where m->>'deadlineMode'='event_relative' and t->>'status'<>'Done' and t->>'due'<>''
      and ((t->>'due')::date+(event_date-(current_plan->>'date')::date) < date '1900-01-01'
        or (t->>'due')::date+(event_date-(current_plan->>'date')::date) > date '2199-12-31'))
     then raise exception 'Shifted deadline out of range' using errcode='22023'; end if;
    select coalesce(jsonb_agg(case when m->>'deadlineMode'='event_relative' and t->>'status'<>'Done' and t->>'due'<>''
       then jsonb_set(t,'{due}',to_jsonb(((t->>'due')::date+(event_date-(current_plan->>'date')::date))::text))
       else t end order by n),'[]'::jsonb) into result
     from jsonb_array_elements(current_plan->'tasks') with ordinality as items(t,n)
     left join lateral (select rule from jsonb_array_elements(current_plan->'planning'->'tasks') rule where rule->>'id'=t->>'id') meta(m) on true;
    candidate:=jsonb_set(candidate,'{tasks}',result);
   elsif p_kind='venue' then
    if p_value is null or length(trim(p_value)) not between 1 and 200 then raise exception 'Invalid venue' using errcode='22023'; end if;
    candidate:=jsonb_set(candidate,'{location}',to_jsonb(trim(p_value)));
   else raise exception 'Invalid change' using errcode='22023'; end if;
   if (p_kind='date' and p_value<>current_plan->>'date') or (p_kind='venue' and trim(p_value)<>current_plan->>'location') then
    select coalesce(jsonb_agg(case when item->>'status' in ('Confirmed','Requested')
      then jsonb_set(item,'{status}','"Reconfirmation needed"'::jsonb) else item end order by n),'[]'::jsonb)
      into result from jsonb_array_elements(current_plan->'resources') with ordinality as items(item,n);
    candidate:=jsonb_set(candidate,'{resources}',result);
   end if;
   insert into private.event_change_proposals(id,event_id,owner_id,base_revision,kind,value,before_plan,proposed_plan,status)
    values(p_id,p_event,auth.uid(),rev,p_kind,p_value,current_plan,candidate,'ready') returning * into proposal;
  end if;
 elsif proposal.id is null then raise exception 'Proposal not found' using errcode='P0002';
 elsif p_action='discard' then
  if proposal.status='discarded' then null;
  elsif proposal.status='ready' then update private.event_change_proposals set status='discarded' where id=p_id returning * into proposal;
  else raise exception 'Proposal conflict' using errcode='40001'; end if;
 elsif p_action='apply' then
  if proposal.status='applied' then null;
  else
   if proposal.status<>'ready' or rev<>proposal.base_revision or p_expected<>proposal.base_revision then raise exception 'Stale proposal' using errcode='40001'; end if;
   perform private.write_event_plan(jsonb_set(proposal.proposed_plan,'{revision}',to_jsonb(rev+1)),rev,p_id);
   update private.event_change_proposals set status='applied',applied_revision=rev+1 where id=p_id returning * into proposal;
  end if;
 elsif p_action='rollback' then
  if proposal.status='rolled_back' then null;
  else
   if proposal.status<>'applied' or rev<>proposal.applied_revision then raise exception 'Later edits protected' using errcode='40001'; end if;
   perform private.write_event_plan(jsonb_set(proposal.before_plan,'{revision}',to_jsonb(rev+1)),rev,md5(p_id::text||':event-change-rollback')::uuid);
   update private.event_change_proposals set status='rolled_back' where id=p_id returning * into proposal;
  end if;
 else raise exception 'Invalid action' using errcode='22023'; end if;
 return to_jsonb(proposal)-'owner_id';
end $function$
;


-- Source: 20261027144651_validate_planning_metadata_shape.sql
-- SHA-256 of normalized source: 5dab8b8ef21a560acdbbf3214e3cc372f78eeca09c9fc3acdb02ea784840d91f
CREATE OR REPLACE FUNCTION private.write_event_plan(p_plan jsonb, p_expected_revision integer, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 event_id_value uuid; current_revision integer; next_revision integer;
 existing_op public.event_operations%rowtype; value jsonb; ordinal bigint; result_plan jsonb; planning_value jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_operation_id is null then raise exception 'Invalid plan' using errcode='22023'; end if;
 event_id_value:=(p_plan->>'id')::uuid;
 if p_expected_revision < -1 or p_expected_revision > 1000000000 then raise exception 'Invalid revision' using errcode='22023'; end if;
 -- Serialize creation and writes to this ID, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended(event_id_value::text,0));
 if exists(select 1 from public.events e where e.id=event_id_value and e.owner_id<>auth.uid()) then
  raise exception 'Event not found' using errcode='P0002';
 end if;
 select * into existing_op from public.event_operations o where o.event_id=event_id_value and o.operation_id=p_operation_id;
 if found then
  if existing_op.payload_hash<>md5(p_plan::text) or existing_op.expected_revision<>p_expected_revision then raise exception 'Operation conflict' using errcode='40001'; end if;
  return existing_op.result;
 end if;
 select e.revision into current_revision from public.events e where e.id=event_id_value and e.owner_id=auth.uid() for update;
 if p_expected_revision=-1 then
  if found then raise exception 'Already exists' using errcode='40001'; end if;
 else
  if not found then raise exception 'Event not found' using errcode='P0002'; end if;
  if current_revision<>p_expected_revision then raise exception 'Stale revision' using errcode='40001'; end if;
 end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where not exists(select 1 from jsonb_array_elements(p_plan->'groups') g where g->>'id'=t->>'groupId')) then raise exception 'Task group not in plan' using errcode='22023'; end if;
 if p_plan ? 'sourcing' and (jsonb_typeof(p_plan->'sourcing') is distinct from 'object' or octet_length((p_plan->'sourcing')::text)>512) then raise exception 'Invalid sourcing settings' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_plan->'resources') resource where resource ? 'details' and (jsonb_typeof(resource->'details') is distinct from 'object' or octet_length((resource->'details')::text)>8192)) then raise exception 'Invalid resource details' using errcode='22023'; end if;
 if p_plan ? 'brief' and (jsonb_typeof(p_plan->'brief') is distinct from 'object' or octet_length((p_plan->'brief')::text)>8192) then raise exception 'Invalid event brief' using errcode='22023'; end if;
 if p_plan ? 'archived' and jsonb_typeof(p_plan->'archived') is distinct from 'boolean' then raise exception 'Invalid archive state' using errcode='22023'; end if;

 -- Validate effective dependency links, including links omitted by older clients.
 if exists(with links as (
  select (j->>'id')::uuid as id,
   case when j ? 'dependsOn' then nullif(j->>'dependsOn','')::uuid
    else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(j->>'id')::uuid) end as dep
  from jsonb_array_elements(p_plan->'tasks') j
 ) select 1 from links l where l.dep is not null and not exists(select 1 from links target where target.id=l.dep))
 then raise exception 'Dependency must reference a task in this event' using errcode='22023'; end if;
 if exists(with recursive links as (
  select (j->>'id')::uuid as id,
   case when j ? 'dependsOn' then nullif(j->>'dependsOn','')::uuid
    else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(j->>'id')::uuid) end as dep
  from jsonb_array_elements(p_plan->'tasks') j
 ), paths(start_id,id) as (
  select id,dep from links where dep is not null
  union select paths.start_id,links.dep from paths join links on links.id=paths.id where links.dep is not null
 ) select 1 from paths where start_id=id)
 then raise exception 'Task dependency cycle' using errcode='22023'; end if;

 planning_value:=coalesce(p_plan->'planning',(select e.planning from public.events e where e.id=event_id_value),'{"budget":[],"tasks":[]}'::jsonb);
 if jsonb_typeof(planning_value) is distinct from 'object' or octet_length(planning_value::text)>65536
  or jsonb_typeof(planning_value->'budget') is distinct from 'array'
  or jsonb_typeof(planning_value->'tasks') is distinct from 'array' then raise exception 'Invalid planning metadata' using errcode='22023'; end if;
 if planning_value ? 'capacity' and (coalesce(planning_value->>'capacity','') !~ '^[0-9]{1,6}$' or (planning_value->>'capacity')::integer not between 1 and 100000) then raise exception 'Invalid capacity' using errcode='22023'; end if;

 if (planning_value-array['capacity','budget','tasks'])<>'{}'::jsonb
  or (planning_value ? 'capacity' and jsonb_typeof(planning_value->'capacity') is distinct from 'number')
  or exists(select 1 from jsonb_array_elements(planning_value->'budget') m
   where jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'id') is distinct from 'string'
    or (m-array['id','basis','unitCost'])<>'{}'::jsonb
    or (m->>'basis'='per_attendee' and jsonb_typeof(m->'unitCost') is distinct from 'number')
    or (m->>'basis'<>'per_attendee' and m ? 'unitCost'))
  or exists(select 1 from jsonb_array_elements(planning_value->'tasks') m
   where jsonb_typeof(m) is distinct from 'object' or jsonb_typeof(m->'id') is distinct from 'string'
    or (m-array['id','deadlineMode'])<>'{}'::jsonb)
 then raise exception 'Invalid planning metadata fields' using errcode='22023'; end if;
 if jsonb_array_length(planning_value->'budget')>100 or jsonb_array_length(planning_value->'tasks')>500
  or exists(select 1 from jsonb_array_elements(planning_value->'budget') m where coalesce(m->>'id','')='' or coalesce(m->>'basis','') not in ('manual','fixed','per_attendee')
   or (m->>'basis'='per_attendee' and (coalesce(m->>'unitCost','') !~ '^[0-9]{1,10}$' or (m->>'unitCost')::bigint>1000000000))
   or not exists(select 1 from jsonb_array_elements(p_plan->'budget') b where b->>'id'=m->>'id'))
  or exists(select 1 from jsonb_array_elements(planning_value->'tasks') m where coalesce(m->>'id','')='' or coalesce(m->>'deadlineMode','') not in ('fixed','event_relative')
   or not exists(select 1 from jsonb_array_elements(p_plan->'tasks') t where t->>'id'=m->>'id'))
  or exists(select 1 from jsonb_array_elements(planning_value->'budget') m group by m->>'id' having count(*)>1)
  or exists(select 1 from jsonb_array_elements(planning_value->'tasks') m group by m->>'id' having count(*)>1)
 then raise exception 'Invalid planning references' using errcode='22023'; end if;

 next_revision:=p_expected_revision+1;
 if (p_plan->>'revision')::integer<>next_revision then raise exception 'Invalid revision' using errcode='22023'; end if;
 if (p_plan ?& array['groups','tasks','budget','resources','agenda']) is not true then raise exception 'Missing collections' using errcode='22023'; end if;
 if jsonb_typeof(p_plan->'groups')<>'array' or jsonb_typeof(p_plan->'tasks')<>'array' or jsonb_typeof(p_plan->'budget')<>'array' or jsonb_typeof(p_plan->'resources')<>'array' or jsonb_typeof(p_plan->'agenda')<>'array' then raise exception 'Invalid collections' using errcode='22023'; end if;
 if jsonb_array_length(p_plan->'groups')>50 or jsonb_array_length(p_plan->'tasks')>500 or jsonb_array_length(p_plan->'budget')>100 or jsonb_array_length(p_plan->'resources')>100 or jsonb_array_length(p_plan->'agenda')>100 then raise exception 'Plan too large' using errcode='22023'; end if;
 if octet_length(p_plan::text)>262144 then raise exception 'Plan too large' using errcode='22023'; end if;
 insert into public.events(id,owner_id,name,description,kind,date,location,guests,confirmed,pending,spending_limit,revision,color,sourcing,brief,archived,planning)
 values(event_id_value,auth.uid(),p_plan->>'name',p_plan->>'description',p_plan->>'kind',(p_plan->>'date')::date,p_plan->>'location',(p_plan->>'guests')::integer,(p_plan->>'confirmed')::bigint,(p_plan->>'pending')::bigint,(p_plan->>'limit')::bigint,next_revision,p_plan->>'color',coalesce(p_plan->'sourcing',(select e.sourcing from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce(p_plan->'brief',(select e.brief from public.events e where e.id=event_id_value),'{}'::jsonb),coalesce((p_plan->>'archived')::boolean,(select e.archived from public.events e where e.id=event_id_value),false),planning_value)
 on conflict(id) do update set name=excluded.name,description=excluded.description,kind=excluded.kind,date=excluded.date,location=excluded.location,guests=excluded.guests,confirmed=excluded.confirmed,pending=excluded.pending,spending_limit=excluded.spending_limit,revision=excluded.revision,color=excluded.color,sourcing=excluded.sourcing,brief=excluded.brief,archived=excluded.archived,planning=excluded.planning,updated_at=now();

 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'groups') with ordinality as items(v,n) loop
  insert into public.task_groups(event_id,id,name,position) values(event_id_value,(value->>'id')::uuid,value->>'name',ordinal)
  on conflict(event_id,id) do update set name=excluded.name,position=excluded.position;
 end loop;
 delete from public.tasks t where t.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') j where (j->>'id')::uuid=t.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'tasks') with ordinality as items(v,n) loop
  insert into public.tasks(event_id,id,group_id,title,notes,owner_label,due,priority,status,position,depends_on)
  values(event_id_value,(value->>'id')::uuid,(value->>'groupId')::uuid,value->>'title',value->>'notes',value->>'owner',nullif(value->>'due','')::date,value->>'priority',value->>'status',ordinal,case when value ? 'dependsOn' then nullif(value->>'dependsOn','')::uuid else (select t.depends_on from public.tasks t where t.event_id=event_id_value and t.id=(value->>'id')::uuid) end)
  on conflict(event_id,id) do update set group_id=excluded.group_id,title=excluded.title,notes=excluded.notes,owner_label=excluded.owner_label,due=excluded.due,priority=excluded.priority,status=excluded.status,position=excluded.position,depends_on=excluded.depends_on;
 end loop;
 delete from public.task_groups g where g.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'groups') j where (j->>'id')::uuid=g.id);
 -- Remove only records absent from the proposed plan. Surviving entity IDs remain stable.
 delete from public.budget_items b where b.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'budget') j where (j->>'id')::uuid=b.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'budget') with ordinality as items(v,n) loop
  insert into public.budget_items(event_id,id,name,category,estimate,actual,committed,position)
  values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'category',(value->>'estimate')::bigint,(value->>'actual')::bigint,(value->>'committed')::boolean,ordinal)
  on conflict(event_id,id) do update set name=excluded.name,category=excluded.category,estimate=excluded.estimate,actual=excluded.actual,committed=excluded.committed,position=excluded.position;
 end loop;
 delete from public.resources r where r.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'resources') j where (j->>'id')::uuid=r.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'resources') with ordinality as items(v,n) loop
  insert into public.resources(event_id,id,name,source,status,position,details) values(event_id_value,(value->>'id')::uuid,value->>'name',value->>'source',value->>'status',ordinal,coalesce(value->'details',(select r.details from public.resources r where r.event_id=event_id_value and r.id=(value->>'id')::uuid),'{}'::jsonb))
  on conflict(event_id,id) do update set name=excluded.name,source=excluded.source,status=excluded.status,position=excluded.position,details=excluded.details;
 end loop;
 delete from public.agenda_items a where a.event_id=event_id_value and not exists(select 1 from jsonb_array_elements(p_plan->'agenda') j where (j->>'id')::uuid=a.id);
 for value,ordinal in select v,n from jsonb_array_elements(p_plan->'agenda') with ordinality as items(v,n) loop
  insert into public.agenda_items(event_id,id,time,title,owner_label,position) values(event_id_value,(value->>'id')::uuid,(value->>'time')::time,value->>'title',value->>'owner',ordinal)
  on conflict(event_id,id) do update set time=excluded.time,title=excluded.title,owner_label=excluded.owner_label,position=excluded.position;
 end loop;
 result_plan:=public.read_event_plan(event_id_value);
 delete from public.event_operations o where o.event_id=event_id_value and o.created_at<now()-interval '7 days';
 insert into public.event_operations(event_id,operation_id,expected_revision,payload_hash,result) values(event_id_value,p_operation_id,p_expected_revision,md5(p_plan::text),result_plan);
 return result_plan;
end $function$
;


-- Source: 20261028140417_review_performance_indexes.sql
-- SHA-256 of normalized source: 4d41e01ce3453ac797d0ea818182583bec607eaa664a09984a7e2d6e75710433
-- Cover foreign keys and event-scoped recent proposal lists. No data or grants change.
create index if not exists event_change_proposals_event_created_idx on private.event_change_proposals (event_id, created_at desc);
create index if not exists event_change_proposals_owner_idx on private.event_change_proposals (owner_id);
create index if not exists funding_proposals_event_created_idx on private.funding_proposals (event_id, created_at desc);
create index if not exists funding_proposals_owner_idx on private.funding_proposals (owner_id);
create index if not exists tasks_event_group_idx on public.tasks (event_id, group_id);


-- Source: 20261028151906_directory_shared_gate.sql
-- SHA-256 of normalized source: e77d2345ab904d7e65c7858c1cbd54fa635f8ce177c064242b2b6fdcf5574aed
-- Shared, bounded coordination for directory searches across API processes.
-- The public wrapper exposes only reservation and owner-held lease release, not table access.
create table private.directory_gate (
 id boolean primary key default true check (id),
 quota_day date not null,
 used integer not null check (used between 0 and 50),
 lease_id uuid,
 lease_owner uuid,
 lease_until timestamptz,
 next_allowed timestamptz not null default '-infinity'::timestamptz
);
alter table private.directory_gate enable row level security;
revoke all on private.directory_gate from public, anon, authenticated;
insert into private.directory_gate(id,quota_day,used) values(true,(now() at time zone 'UTC')::date,0);

create function private.directory_gate_action(p_action text,p_lease uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare state private.directory_gate%rowtype; today date:=(clock_timestamp() at time zone 'UTC')::date; moment timestamptz:=clock_timestamp(); lease uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select * into state from private.directory_gate where id=true for update;
 if p_action='reserve' then
  if state.quota_day<>today then update private.directory_gate set quota_day=today,used=0 where id=true; state.used:=0; end if;
  if state.lease_until>moment or state.next_allowed>moment then return jsonb_build_object('status','busy'); end if;
  if state.used>=50 then return jsonb_build_object('status','limit'); end if;
  lease:=gen_random_uuid();
  update private.directory_gate set used=used+1,lease_id=lease,lease_owner=auth.uid(),lease_until=moment+interval '45 seconds',next_allowed=moment+interval '1100 milliseconds' where id=true;
  return jsonb_build_object('status','reserved','lease',lease);
 elsif p_action='release' then
  if p_lease is null then raise exception 'Invalid lease' using errcode='22023'; end if;
  if state.lease_id=p_lease and state.lease_owner=auth.uid() then
   update private.directory_gate set lease_id=null,lease_owner=null,lease_until=null,next_allowed=greatest(next_allowed,moment+interval '1100 milliseconds') where id=true;
  end if;
  return jsonb_build_object('status','released');
 end if;
 raise exception 'Invalid action' using errcode='22023';
end $function$;
revoke all on function private.directory_gate_action(text,uuid) from public,anon,authenticated;
grant execute on function private.directory_gate_action(text,uuid) to authenticated;
create function public.directory_gate_action(p_action text,p_lease uuid default null) returns jsonb
language sql security invoker set search_path='' as $function$
 select private.directory_gate_action(p_action,p_lease)
$function$;
revoke all on function public.directory_gate_action(text,uuid) from public,anon,authenticated;
grant execute on function public.directory_gate_action(text,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
