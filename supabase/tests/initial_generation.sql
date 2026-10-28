begin;
do $test$
declare actor uuid; event_id uuid:=gen_random_uuid(); operation_id uuid:=gen_random_uuid(); proposal_id uuid:=gen_random_uuid();
 retained_group uuid:=gen_random_uuid(); group_id uuid:=gen_random_uuid(); task_id uuid:=gen_random_uuid(); plan jsonb; candidate jsonb; result jsonb; denied boolean;
begin
 select id into actor from auth.users order by created_at limit 1;
 if actor is null then raise exception 'Test requires an existing confirmed account'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 plan:=jsonb_build_object('id',event_id,'name','Transactional generation test','description','Synthetic test data',
 'kind','Community gathering','date','2026-12-01','location','Test venue','guests',10,'confirmed',10000,'pending',0,
 'limit',10000,'revision',0,'color','cobalt','groups',jsonb_build_array(jsonb_build_object('id',retained_group,'name','Organizer custom group')),'tasks','[]'::jsonb,'budget','[]'::jsonb,'resources','[]'::jsonb,'agenda','[]'::jsonb);
 perform public.write_event_plan(plan,-1,operation_id);
 plan:=public.read_event_plan(event_id);
 result:=public.plan_proposal_action('reserve',event_id,proposal_id,0,'{"cacheKey":"transaction-test"}');
 if result->>'status'<>'running' then raise exception 'Reservation failed'; end if;
 denied:=false;
 begin perform public.plan_proposal_action('reserve',event_id,proposal_id,0,'{"cacheKey":"transaction-test"}');
 exception when sqlstate 'P1002' then denied:=true; end;
 if not denied then raise exception 'Duplicate worker was not blocked'; end if;
 candidate:=jsonb_set(jsonb_set(plan,'{groups}',(plan->'groups')||jsonb_build_array(jsonb_build_object('id',group_id,'name','Preparation'))),
 '{tasks}',jsonb_build_array(jsonb_build_object('id',task_id,'groupId',group_id,'title','Synthetic task','notes','Test note',
 'owner','','due','2026-11-30','priority','Medium','status','To do')));
 denied:=false;
 begin
  perform public.plan_proposal_action('complete',event_id,proposal_id,0,jsonb_build_object('plan',jsonb_set(candidate,'{groups}',jsonb_build_array(jsonb_build_object('id',group_id,'name','Preparation'))),
   'summary','Invalid removed group','assumptions','[]'::jsonb,'provider','groq','model','fixture','attempts',1));
 exception when invalid_parameter_value then denied:=true; end;
 if not denied then raise exception 'Existing group removal was not denied'; end if;
 result:=public.plan_proposal_action('complete',event_id,proposal_id,0,jsonb_build_object('plan',candidate,'summary','Synthetic proposal',
 'assumptions',jsonb_build_array('No real booking'),'provider','groq','model','fixture','attempts',1));
 if result->>'status'<>'ready' or public.read_event_plan(event_id)->'tasks'<>'[]'::jsonb then raise exception 'Generation mutated live plan'; end if;
 result:=public.plan_proposal_action('reserve',event_id,gen_random_uuid(),0,'{"cacheKey":"transaction-test"}');
 if result->>'id'<>proposal_id::text then raise exception 'Cache was not reused'; end if;
 if jsonb_array_length(public.plan_proposal_action('list',event_id,null,null))<>1 then raise exception 'Proposal persistence failed'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 denied:=false;
 begin perform public.plan_proposal_action('list',event_id,null,null);
 exception when no_data_found then denied:=true; end;
 if not denied then raise exception 'Cross-user access not denied'; end if;
 if exists(select 1 from public.plan_proposals where id=proposal_id) then raise exception 'Cross-user RLS failed'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 denied:=false;
 begin
  perform public.write_event_plan(jsonb_set(plan,'{revision}','1'::jsonb),0,gen_random_uuid());
  perform public.plan_proposal_action('apply',event_id,proposal_id,0);
 exception when serialization_failure then denied:=true;
 end;
 if not denied then raise exception 'Stale apply not denied'; end if;
 result:=public.plan_proposal_action('apply',event_id,proposal_id,0);
 if result->>'status'<>'applied' or (public.read_event_plan(event_id)->>'revision')::integer<>1 then raise exception 'Atomic apply failed'; end if;
 perform public.plan_proposal_action('apply',event_id,proposal_id,0);
 if (public.read_event_plan(event_id)->>'revision')::integer<>1 then raise exception 'Duplicate apply changed revision'; end if;
 denied:=false;
 begin
  perform public.write_event_plan(jsonb_set(candidate,'{revision}','2'::jsonb),1,gen_random_uuid());
  perform public.plan_proposal_action('rollback',event_id,proposal_id,0);
 exception when serialization_failure then denied:=true;
 end;
 if not denied then raise exception 'Later edits not protected'; end if;
 result:=public.plan_proposal_action('rollback',event_id,proposal_id,0);
 if result->>'status'<>'rolled_back' or public.read_event_plan(event_id)->'tasks'<>'[]'::jsonb
  or (public.read_event_plan(event_id)->>'revision')::integer<>2 then raise exception 'Rollback failed'; end if;
 perform public.plan_proposal_action('rollback',event_id,proposal_id,0);
 if (public.read_event_plan(event_id)->>'revision')::integer<>2 then raise exception 'Duplicate rollback changed revision'; end if;
end $test$;
rollback;
select 'transactional proposal checks passed; synthetic writes rolled back' as result;