import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Check, ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { moveTask, taskSchema, validateTaskDependencies, type EventPlan, type Task } from '@gather/core';
import { Drawer } from '../components/Dialog';
import { GroupManager } from './GroupManager';
import type { Studio } from '../state/useStudio';

function TaskRow({task,onEdit,onComplete,onDelete,onMove}:{
 task:Task;onEdit:()=>void;onComplete:()=>void;onDelete:()=>void;onMove:(d:-1|1)=>void;
}) {
 const {attributes,listeners,setNodeRef,transform,transition,isDragging} = useSortable({id:task.id});
 return <motion.div layout="position" ref={setNodeRef} style={{transform:CSS.Transform.toString(transform),transition,zIndex:isDragging?2:undefined}} className={'task-row '+(task.status==='Done'?'done ':'')+(isDragging?'dragging':'')}>
  <button className="drag-handle" {...attributes} {...listeners} aria-label={'Drag '+task.title}><GripVertical size={16}/></button>
  <button className="task-check" onClick={onComplete} role="checkbox" aria-checked={task.status==='Done'} aria-label={'Complete '+task.title}>{task.status==='Done'&&<Check size={14}/>}</button>
  <button className="task-title" onClick={onEdit}>{task.title}<span className="task-subtitle">{task.status==='Blocked'?'Blocked · ':''}{task.priority} priority</span></button>
  <span className={'task-status status-'+task.status.toLowerCase().replaceAll(' ','-')}>{task.status}</span>
  <span className="avatar small" title={task.owner||'Unassigned'}>{(task.owner||'?').slice(0,2).toUpperCase()}</span>
  <span className="task-due">{task.due?new Date(task.due+'T12:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}):'No date'}</span>
  <div className="row-actions"><button className="icon-button tiny" onClick={()=>onMove(-1)} aria-label={'Move '+task.title+' up'}><ArrowUp size={14}/></button><button className="icon-button tiny" onClick={()=>onMove(1)} aria-label={'Move '+task.title+' down'}><ArrowDown size={14}/></button><button className="icon-button tiny" onClick={onDelete} aria-label={'Delete '+task.title}><Trash2 size={14}/></button></div>
 </motion.div>;
}
function newTask(event: EventPlan, groupId?:string): Task {
 return {id:crypto.randomUUID(),groupId:groupId??event.groups[0].id,title:'',notes:'',owner:'You',due:'',priority:'Medium',status:'To do'};
}
export function Tasks({studio,compact=false}: {studio:Studio;compact?:boolean}) {
 const {event,update}=studio;
 const [filter,setFilter]=useState('All');
 const [collapsed,setCollapsed]=useState<string[]>([]);
 const [editing,setEditing]=useState<Task|null>(null);
 const [isNew,setIsNew]=useState(false);
 const [error,setError]=useState('');
 const [groupName,setGroupName]=useState('');
 const [groupEditor,setGroupEditor]=useState(false);
 const [manageGroups,setManageGroups]=useState(false);
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
 const done=event.tasks.filter(t=>t.status==='Done').length;
 const visible = event.tasks.filter(t=>filter==='All'||(filter==='Open'?t.status!=='Done':t.status===filter));
 function openTask(task?:Task,groupId?:string){setEditing(task?{...task}:newTask(event,groupId));setIsNew(!task);setError('');}
 function reorder(ev:DragEndEvent) {
  if(!ev.over||ev.active.id===ev.over.id)return;
  const active=event.tasks.find(t=>t.id===ev.active.id), over=event.tasks.find(t=>t.id===ev.over?.id);
  if(!active||!over||active.groupId!==over.groupId)return;
  const tasks=[...event.tasks], from=tasks.findIndex(t=>t.id===active.id),to=tasks.findIndex(t=>t.id===over.id);
  tasks.splice(to,0,tasks.splice(from,1)[0]); update({...event,tasks},'Task reordered.');
 }
 return <section className={'panel task-panel '+(compact?'compact':'')}>
  <div className="section-heading"><div><h2>{compact?'Your next little steps.':'Every little step counts.'}</h2><p className="muted">{done} of {event.tasks.length} complete. You are making it happen.</p></div><button className="button secondary" onClick={()=>openTask()} disabled={!event.groups.length}><Plus size={15}/>Add task</button></div>
  <div className="progress-track" role="progressbar" aria-label="Tasks completed" aria-valuenow={done} aria-valuemin={0} aria-valuemax={event.tasks.length||1}><span style={{width:(event.tasks.length?done/event.tasks.length*100:0)+'%'}}/></div>
  <div className="task-toolbar"><div className="segmented" aria-label="Filter tasks">{['All','Open','Done'].map(value=><button key={value} onClick={()=>setFilter(value)} aria-pressed={filter===value}>{value}</button>)}</div>{!compact&&<><button className="text-button" onClick={()=>{setError('');setGroupEditor(true);}} disabled={event.groups.length>=50}><Plus size={14}/>Add group</button><button className="text-button" onClick={()=>setManageGroups(true)}>Manage groups</button></>}</div>
  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
  {event.groups.map(group=>{
   const tasks=visible.filter(t=>t.groupId===group.id);const closed=collapsed.includes(group.id);
   return <div className="task-group" key={group.id}><div className="group-heading"><button className="group-toggle" onClick={()=>setCollapsed(c=>closed?c.filter(id=>id!==group.id):[...c,group.id])} aria-expanded={!closed}><ChevronDown size={14} className={closed?'collapsed':''}/>{group.name}<span>{tasks.length}</span></button><button className="icon-button tiny" onClick={()=>openTask(undefined,group.id)} aria-label={'Add task to '+group.name}><Plus size={15}/></button></div>
    <AnimatePresence initial={false}>{!closed&&<motion.div key="rows" initial={{opacity:0,height:0}} animate={{opacity:1,height:'auto'}} exit={{opacity:0,height:0}}><SortableContext items={tasks.map(t=>t.id)} strategy={verticalListSortingStrategy}>
     {tasks.map(task=><TaskRow key={task.id} task={task} onEdit={()=>openTask(task)} onComplete={()=>update({...event,tasks:event.tasks.map(t=>t.id===task.id?{...t,status:t.status==='Done'?'To do':'Done'}:t)},task.status==='Done'?'Task reopened.':'One step closer. Task complete.')} onDelete={()=>update({...event,planning:event.planning?{...event.planning,tasks:event.planning.tasks.filter(item=>item.id!==task.id)}:undefined,tasks:event.tasks.filter(t=>t.id!==task.id).map(t=>t.dependsOn===task.id?{...t,dependsOn:null}:t)},'Task deleted and prerequisite links cleared. Undo restores all details.')} onMove={d=>update(moveTask(event,task.id,d),'Task reordered.')}/>)}
     {!tasks.length&&<p className="empty-state">A little breathing room. Add a task when you are ready.</p>}
    </SortableContext></motion.div>}</AnimatePresence>
   </div>;
  })}
  </DndContext>
  <button className="add-row" onClick={()=>openTask()} disabled={!event.groups.length}><Plus size={16}/>A new next step</button>
  <Drawer title={isNew?'A new next step.':'Make it yours.'} description="Changes are saved to your workspace. You can undo the latest change in this session." open={Boolean(editing)} onClose={()=>setEditing(null)}>
   {editing&&<form className="form-stack" onSubmit={ev=>{ev.preventDefault();const result=taskSchema.safeParse(editing);if(!result.success){setError('Add a task title (up to 200 characters) and check the fields.');return;}const tasks=isNew?[...event.tasks,result.data]:event.tasks.map(t=>t.id===editing.id?result.data:t);try{validateTaskDependencies(tasks);}catch{setError('Choose an existing prerequisite that does not create a cycle.');return;}if(update({...event,tasks},isNew?'Task added.':'Task updated.'))setEditing(null);else setError('Could not save this task. Check the event item limits and other fields.');}}>
    <label>Task title<input autoFocus value={editing.title} required maxLength={200} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
    <div className="field-pair"><label>Group<select value={editing.groupId} onChange={e=>setEditing({...editing,groupId:e.target.value})}>{event.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label>Owner or role<input value={editing.owner} maxLength={80} onChange={e=>setEditing({...editing,owner:e.target.value})}/></label></div>
    <div className="field-pair"><label>Due date<input type="date" value={editing.due} onChange={e=>setEditing({...editing,due:e.target.value})}/></label><label>Priority<select value={editing.priority} onChange={e=>setEditing({...editing,priority:e.target.value as Task['priority']})}>{['Low','Medium','High'].map(v=><option key={v}>{v}</option>)}</select></label></div>
    <label>Prerequisite task (optional)<select value={editing.dependsOn??''} onChange={e=>setEditing({...editing,dependsOn:e.target.value||null})}><option value="">No prerequisite</option>{event.tasks.filter(task=>task.id!==editing.id).map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
    {editing.dependsOn&&event.tasks.find(task=>task.id===editing.dependsOn)?.status!=='Done'&&<p className="fine-print">The prerequisite is not completed yet. Task status stays under your control.</p>}
    <label>Status<select value={editing.status} onChange={e=>setEditing({...editing,status:e.target.value as Task['status']})}>{['To do','In progress','Blocked','Done'].map(v=><option key={v}>{v}</option>)}</select></label>
    <label>Notes<textarea rows={4} value={editing.notes} maxLength={2000} onChange={e=>setEditing({...editing,notes:e.target.value})}/></label>
    {error&&<p role="alert" className="error-box">{error}</p>}<button className="button primary" type="submit">Save task<Check size={16}/></button>
   </form>}
  </Drawer>
  {manageGroups&&<GroupManager key={event.id} studio={studio} onClose={()=>setManageGroups(false)}/>}
  <Drawer title="A place for the details." description="Add a category to organize your event checklist." open={groupEditor} onClose={()=>setGroupEditor(false)}><form className="form-stack" onSubmit={e=>{e.preventDefault();if(!groupName.trim())return;if(update({...event,groups:[...event.groups,{id:crypto.randomUUID(),name:groupName.trim()}]},'Group added.')){setGroupName('');setGroupEditor(false);}else setError('Could not add the group. Check the event item limits.');}}><label>Group name<input required maxLength={80} value={groupName} onChange={e=>setGroupName(e.target.value)}/></label>{error&&<p role="alert" className="error-box">{error}</p>}<button className="button primary">Add group</button></form></Drawer>
 </section>;
}
