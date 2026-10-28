import { useState } from 'react';
import { Drawer } from '../components/Dialog';
import { removeTaskGroup } from '@gather/core';
import type { Studio } from '../state/useStudio';

export function GroupManager({studio,onClose}:{studio:Studio;onClose:()=>void}) {
 const {event,update}=studio;
 const [selected,setSelected]=useState(event.groups[0]?.id??'');
 const [name,setName]=useState(event.groups[0]?.name??'');
 const [destination,setDestination]=useState('');
 const group=event.groups.find(item=>item.id===selected);
 const tasks=event.tasks.filter(item=>item.groupId===selected);
 const alternatives=event.groups.filter(item=>item.id!==selected);
 const canRemove=Boolean(group)&&(!tasks.length||alternatives.some(item=>item.id===destination));
 return <Drawer open onClose={onClose} title="Manage task groups" description="Rename groups or remove one after choosing where its tasks should go.">
  {!event.groups.length?<p>No groups yet. Add a group from your plan.</p>:<div className="form-stack">
   <label>Group<select value={selected} onChange={e=>{const id=e.target.value;setSelected(id);setName(event.groups.find(item=>item.id===id)?.name??'');setDestination('');}}>{event.groups.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
   <form className="form-stack" onSubmit={e=>{e.preventDefault();if(!name.trim()||!group)return;update({...event,groups:event.groups.map(item=>item.id===selected?{...item,name:name.trim()}:item)},'Group renamed.');}}>
    <label>Group name<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
    <button className="button secondary">Rename group</button>
   </form>
   <p>{tasks.length} task{tasks.length===1?'':'s'} in this group. Their details and completion status are preserved.</p>
   {tasks.length>0&&<label>Move tasks to<select value={destination} onChange={e=>setDestination(e.target.value)}><option value="">Choose another group</option>{alternatives.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
   {tasks.length>0&&!alternatives.length&&<p className="fine-print">Add another group first to move these tasks.</p>}
   <button className="button secondary" disabled={!canRemove} onClick={()=>{
    if(!canRemove)return;
    if(update(removeTaskGroup(event,selected,destination||undefined),'Group removed; tasks preserved. Undo is available.'))onClose();
   }}>Remove group</button>
  </div>}
 </Drawer>;
}