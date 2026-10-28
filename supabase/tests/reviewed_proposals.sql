begin;
do $test$
declare
 actor uuid; event_id uuid:=gen_random_uuid(); group_id uuid:=gen_random_uuid();
 task_id uuid:=gen_random_uuid(); budget_id uuid:=gen_random_uuid(); resource_id uuid:=gen_random_uuid();
 funding_id uuid:=gen_random_uuid(); change_id uuid:=gen_random_uuid(); date_id uuid:=gen_random_uuid(); stale_id uuid:=gen_random_uuid(); stale_funding_id uuid:=gen_random_uuid();
 plan jsonb; after_plan jsonb; result jsonb; denied boolean;
begin
 select id into actor from auth.users order by created_at limit 1;
 if actor is null then raise exception 'Test requires an existing confirmed account'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 plan:=jsonb_build_object('id',event_id,'name','Synthetic reviewed proposal test','description','Rollback-only fixture',
 'kind','Community gathering','date','2026-12-01','location','Test venue','guests',10,'confirmed',10000,'pending',5000,
 'limit',10000,'revision',0,'color','cobalt',
 'groups',jsonb_build_array(jsonb_build_object('id',group_id,'name','Preparation')),
 'tasks',jsonb_build_array(jsonb_build_object('id',task_id,'groupId',group_id,'title','Finish setup','notes','Keep note','owner','Lead','due','2026-11-30','priority','High','status','To do')),
 'budget',jsonb_build_array(jsonb_build_object('id',budget_id,'name','Meals','category','Food','estimate',1000,'actual',300,'committed',false)),
 'resources',jsonb_build_array(jsonb_build_object('id',resource_id,'name','Space','source','Fixture','status','Confirmed')),
 'agenda','[]'::jsonb,
 'planning',jsonb_build_object('budget',jsonb_build_array(jsonb_build_object('id',budget_id,'basis','per_attendee','unitCost',100)),
 'tasks',jsonb_build_array(jsonb_build_object('id',task_id,'deadlineMode','event_relative'))));
 perform public.write_event_plan(plan,-1,gen_random_uuid());
 plan:=public.read_event_plan(event_id);
 result:=public.funding_proposal_action('create',event_id,funding_id,0,8000,9000);
 if result->>'status'<>'ready' or (public.read_event_plan(event_id)->>'confirmed')::integer<>10000 then raise exception 'Funding preview changed event'; end if;
 perform public.funding_proposal_action('apply',event_id,funding_id,0);
 perform public.funding_proposal_action('apply',event_id,funding_id,0);
 after_plan:=public.read_event_plan(event_id);
 if (after_plan->>'confirmed')::integer<>8000 or (after_plan->>'pending')::integer<>5000 or (after_plan->>'revision')::integer<>1 or after_plan->'budget'<>plan->'budget' then raise exception 'Funding apply failed'; end if;
 perform public.funding_proposal_action('rollback',event_id,funding_id,0);
 perform public.funding_proposal_action('rollback',event_id,funding_id,0);
 after_plan:=public.read_event_plan(event_id);
 if (after_plan->>'confirmed')::integer<>10000 or (after_plan->>'revision')::integer<>2 then raise exception 'Funding restore failed'; end if;
 result:=public.event_change_action('create',event_id,change_id,2,'attendance','20');
 if (public.read_event_plan(event_id)->>'guests')::integer<>10 or (result->'proposed_plan'->'budget'->0->>'estimate')::integer<>2000 then raise exception 'Attendance preview failed'; end if;
 perform public.event_change_action('apply',event_id,change_id,2);
 after_plan:=public.read_event_plan(event_id);
 if (after_plan->>'guests')::integer<>20 or (after_plan->'budget'->0->>'actual')::integer<>300 then raise exception 'Attendance apply failed'; end if;
 perform public.event_change_action('rollback',event_id,change_id,2);
 after_plan:=public.read_event_plan(event_id);
 if (after_plan->>'guests')::integer<>10 or (after_plan->'budget'->0->>'estimate')::integer<>1000 then raise exception 'Attendance rollback failed'; end if;
 result:=public.event_change_action('create',event_id,date_id,4,'date','2026-12-03');
 if result->'proposed_plan'->'tasks'->0->>'due'<>'2026-12-02' or result->'proposed_plan'->'resources'->0->>'status'<>'Reconfirmation needed' then raise exception 'Date preview failed'; end if;
 perform public.event_change_action('apply',event_id,date_id,4);
 after_plan:=public.read_event_plan(event_id);
 if after_plan->>'date'<>'2026-12-03' or after_plan->'tasks'->0->>'due'<>'2026-12-02' then raise exception 'Date apply failed'; end if;
 perform public.event_change_action('rollback',event_id,date_id,4);
 after_plan:=public.read_event_plan(event_id);
 if after_plan->>'date'<>'2026-12-01' or after_plan->'resources'->0->>'status'<>'Confirmed' then raise exception 'Date rollback failed'; end if;
 perform public.event_change_action('create',event_id,stale_id,6,'venue','Other venue');
 perform public.funding_proposal_action('create',event_id,stale_funding_id,6,7000,9000);
 after_plan:=jsonb_set(jsonb_set(after_plan,'{name}',to_jsonb('Later manual edit'::text)),'{revision}','7'::jsonb);
 perform public.write_event_plan(after_plan,6,gen_random_uuid());
 denied:=false;
 begin perform public.event_change_action('apply',event_id,stale_id,6); exception when serialization_failure then denied:=true; end;
 if not denied then raise exception 'Stale event proposal applied'; end if;
 denied:=false;
 begin perform public.funding_proposal_action('apply',event_id,stale_funding_id,6); exception when serialization_failure then denied:=true; end;
 if not denied then raise exception 'Stale funding proposal applied'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;
 begin perform public.funding_proposal_action('list',event_id); exception when sqlstate 'P0002' then denied:=true; end;
 if not denied then raise exception 'Cross-owner funding read allowed'; end if;
 denied:=false;
 begin perform public.event_change_action('list',event_id); exception when sqlstate 'P0002' then denied:=true; end;
 if not denied then raise exception 'Cross-owner event proposal read allowed'; end if;
end $test$;
rollback;
select 'reviewed proposals verified; fixture rolled back' as result;

