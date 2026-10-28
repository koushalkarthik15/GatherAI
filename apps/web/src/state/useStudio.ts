import { useCallback, useEffect, useState } from 'react';
import { eventSchema, eventsSchema, type EventPlan } from '@gather/core';
import { sampleEvents } from '../data/sampleEvents';

const KEY = 'gather-studio-demo-v1';
type Snapshot = { before: EventPlan; appliedRevision: number };
type Data = { events: EventPlan[]; rollbacks: Record<string, Snapshot> };
function load(): { data: Data; error: string } {
 try {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { data: {events: structuredClone(sampleEvents),rollbacks:{}}, error: '' };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('events' in value)) throw new Error();
  const events = eventsSchema.parse(value.events);
  const rollbacks: Record<string, Snapshot> = {};
  if ('rollbacks' in value && value.rollbacks && typeof value.rollbacks === 'object') {
   for (const [id, snapshot] of Object.entries(value.rollbacks)) {
    if (snapshot && typeof snapshot === 'object' && 'before' in snapshot && 'appliedRevision' in snapshot) {
     const before = eventSchema.safeParse(snapshot.before);
     if (before.success && before.data.id === id && Number.isInteger(snapshot.appliedRevision)) {
      rollbacks[id] = {before: before.data, appliedRevision: Number(snapshot.appliedRevision)};
     }
    }
   }
  }
  return { data: {events,rollbacks}, error: '' };
 } catch { return { data: {events: structuredClone(sampleEvents),rollbacks:{}}, error: 'Saved demo data could not be loaded. Samples are available; saving is paused to protect your old data. Reset the demo to start fresh.' }; }
}
export function useStudio() {
 const [initial] = useState(load);
 const [data, setData] = useState<Data>(initial.data);
 const [eventId, setEventId] = useState(initial.data.events[0].id);
 const [history, setHistory] = useState<Record<string, EventPlan[]>>({});
 const [storageError, setStorageError] = useState(initial.error);
 const [paused, setPaused] = useState(Boolean(initial.error));
 const [message, setMessage] = useState('');
 const event = data.events.find(e => e.id === eventId) ?? data.events[0];
 useEffect(() => {
  if (paused) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); setStorageError(''); }
  catch { setStorageError('Browser saving failed. Your edits remain in this tab. Free storage or allow site storage, then retry.'); }
 }, [data, paused]);
 const update = useCallback((next: EventPlan, label: string) => {
  const current = data.events.find(e => e.id === next.id);
  if (!current) return false;
  const result = eventSchema.safeParse({...next, revision:current.revision + 1});
  if (!result.success) { setMessage('This change could not be saved: check dates, field lengths and event item limits.'); return false; }
  const validated = result.data;
  setHistory(h => ({...h, [current.id]:[...(h[current.id] ?? []).slice(-29), structuredClone(current)]}));
  setData(d => ({...d, events:d.events.map(e => e.id === current.id ? validated : e)}));
  setMessage(label);
  return true;
 }, [data.events]);
 function undo() {
  const previous = history[event.id]?.at(-1);
  if (!previous) return;
  setData(d => ({...d,events:d.events.map(e => e.id === event.id ? {...previous,revision:event.revision+1} : e)}));
  setHistory(h => ({...h,[event.id]:h[event.id].slice(0,-1)}));
  setMessage('Last change undone.');
 }
 function apply(next: EventPlan) {
  const before = structuredClone(event);
  setData(d => ({events:d.events.map(e => e.id === next.id ? next : e),
   rollbacks:{...d.rollbacks,[event.id]:{before,appliedRevision:next.revision}}}));
  setHistory(h => ({...h,[event.id]:[]}));
  setMessage('Demo revision applied. Your tasks are preserved.');
 }
 function rollback() {
  const snapshot = data.rollbacks[event.id];
  if (!snapshot || snapshot.appliedRevision !== event.revision) return;
  const rollbacks = {...data.rollbacks}; delete rollbacks[event.id];
  setData({events:data.events.map(e => e.id === event.id ? {...snapshot.before,revision:event.revision+1} : e),rollbacks});
  setHistory(h => ({...h,[event.id]:[]}));
  setMessage('Previous plan restored.');
 }
 function reset() {
  setData({events:structuredClone(sampleEvents),rollbacks:{}});
  setEventId(sampleEvents[0].id); setHistory({}); setPaused(false); setStorageError('');
  setMessage('Sample events restored.');
 }
 return { events:data.events,event,setEventId,update,undo,canUndo:Boolean(history[event.id]?.length),
  apply,rollback,hasRollback:Boolean(data.rollbacks[event.id]),
  canRollback:data.rollbacks[event.id]?.appliedRevision === event.revision,
  reset,storageError,retrySave:()=>{setPaused(false);setData(d=>({...d}));},message,setMessage };
}
export type Studio = ReturnType<typeof useStudio>;
