begin;
do $test$
declare actor uuid; event_id uuid; operation_id uuid; plan jsonb; remaining integer; denied boolean; i integer;
begin
 select id into actor from auth.users order by created_at limit 1;
 remaining:=least(
  5-(select count(*) from public.plan_proposals where owner_id=actor and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')),
  20-(select count(*) from public.plan_proposals where created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')));
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 for i in 0..remaining loop
  event_id:=gen_random_uuid();operation_id:=gen_random_uuid();
  plan:=jsonb_build_object('id',event_id,'name','Synthetic quota test','description','Disposable transaction fixture',
   'kind','Community gathering','date','2026-12-01','location','Fixture','guests',10,'confirmed',10000,'pending',0,
   'limit',10000,'revision',0,'color','cobalt','groups','[]'::jsonb,'tasks','[]'::jsonb,'budget','[]'::jsonb,'resources','[]'::jsonb,'agenda','[]'::jsonb);
  perform public.write_event_plan(plan,-1,gen_random_uuid());
  denied:=false;
  begin perform public.plan_proposal_action('reserve',event_id,operation_id,0,'{"cacheKey":"quota-test"}');
  exception when sqlstate 'P1001' then denied:=true; end;
  if i<remaining and denied then raise exception 'Quota rejected too early'; end if;
  if i=remaining and not denied then raise exception 'Quota failed to block extra request'; end if;
  if not denied then perform public.plan_proposal_action('fail',event_id,operation_id,0); end if;
 end loop;
 denied:=false;
 begin update public.plan_proposals set status='ready' where owner_id=actor;
 exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Direct proposal writes were not denied'; end if;
end $test$;
rollback;
select 'quota including failed attempts and direct-write denial passed; writes rolled back' as result;