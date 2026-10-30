import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudPlanSchema, type CreateEventInput } from '@gather/core/cloud';
import type { EventPlan } from '@gather/core';
import type { Studio } from '../state/studio';
import { cloudApi, SaveError } from './api';
type Job = {
	plan: EventPlan;
	operationId: string;
	expectedRevision?: number;
};
export function useCloudStudio(userId: string) {
	const [api] = useState(() => cloudApi(userId));
	const [events, setEvents] = useState<EventPlan[]>([]);
	const [eventId, setEventId] = useState('');
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [history, setHistory] = useState<Record<string, EventPlan[]>>({});
	const [message, setMessage] = useState('');
	const [, refresh] = useState(0);
	const plans = useRef<EventPlan[]>([]);
	const queues = useRef(new Map<string, Job[]>());
	const saving = useRef(new Set<string>());
	const revisions = useRef(new Map<string, number>());
	const generation = useRef(0);
	const mounted = useRef(false);
	const invalidate = useCallback(() => {
		generation.current++;
	}, []);
	const load = useCallback(async () => {
		const run = ++generation.current;
		setLoading(true);
		setLoadError('');
		// Explicit reload discards pending drafts only after the caller's confirmation.
		queues.current.clear();
		saving.current.clear();
		setErrors({});
		setHistory({});
		try {
			const saved = await api.list();
			if (!mounted.current || generation.current !== run) {
				return;
			}
			plans.current = saved;
			revisions.current = new Map(saved.map(e => [e.id, e.revision]));
			setEvents(saved);
			setEventId(id => saved.some(e => e.id === id) ? id : (saved[0]?.id ?? ''));
		}
		catch (error) {
			if (mounted.current && generation.current === run) {
				setLoadError(error instanceof Error ? error.message : 'Could not load saved events.');
			}
		}
		finally {
			if (mounted.current && generation.current === run) {
				setLoading(false);
			}
		}
	}, [api]);
	useEffect(() => {
		mounted.current = true;
		void load();
		return () => {
			mounted.current = false;
			invalidate();
		};
	}, [load, invalidate]);
	const pending = Array.from(queues.current.values()).some(queue => queue.length > 0);
	useEffect(() => {
		if (!pending) {
			return;
		}
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	}, [pending]);
	async function flush(id: string) {
		if (saving.current.has(id)) {
			return;
		}
		saving.current.add(id);
		refresh(n => n + 1);
		const run = generation.current;
		try {
			while (true) {
				const queue = queues.current.get(id);
				const job = queue?.[0];
				if (!queue || !job) {
					break;
				}
				job.expectedRevision ??= revisions.current.get(id) ?? 0;
				const saved = await api.save(job.plan, job.expectedRevision, job.operationId);
				if (!mounted.current || run !== generation.current) {
					return;
				}
				revisions.current.set(id, saved.revision);
				queue.shift();
				if (!queues.current.get(id)?.length) {
					plans.current = plans.current.map(e => e.id === id ? saved : e);
					setEvents(plans.current);
				}
				setErrors(current => {
					const next = { ...current };
					delete next[id];
					return next;
				});
			}
		}
		catch (error) {
			if (mounted.current && run === generation.current) {
				const text = error instanceof SaveError && error.code === 'REVISION_CONFLICT'
					? 'Another tab or device changed this event. Your edits remain here. Reload the saved version only after preserving any changes you need.'
					: error instanceof Error ? error.message : 'Save failed. Keep this tab open and retry.';
				setErrors(current => ({ ...current, [id]: text }));
			}
		}
		finally {
			if (mounted.current && run === generation.current) {
				saving.current.delete(id);
				refresh(n => n + 1);
			}
		}
	}
	function update(next: EventPlan, label: string, record = true) {
		const current = plans.current.find(e => e.id === next.id);
		if (!current) {
			return false;
		}
		const result = cloudPlanSchema.safeParse({ ...next, revision: current.revision + 1 });
		if (!result.success) {
			setMessage('This change could not be saved: check dates, field lengths and event item limits.');
			return false;
		}
		if (record) {
			setHistory(h => ({ ...h, [current.id]: [...(h[current.id] ?? []).slice(-29), structuredClone(current)] }));
		}
		plans.current = plans.current.map(e => e.id === next.id ? result.data : e);
		setEvents(plans.current);
		const queue = queues.current.get(next.id) ?? [];
		queue.push({ plan: structuredClone(result.data), operationId: crypto.randomUUID() });
		queues.current.set(next.id, queue);
		setMessage(label);
		// A failed queue pauses until explicit retry. New edits remain queued safely.
		if (!errors[next.id]) {
			void flush(next.id);
		}
		return true;
	}
	const event = events.find(e => e.id === eventId) ?? events[0];
	function undo() {
		if (!event) {
			return;
		}
		const previous = history[event.id]?.at(-1);
		if (!previous) {
			return;
		}
		if (!update(previous, 'Last change undone.', false)) {
			return;
		}
		setHistory(h => ({ ...h, [event.id]: h[event.id].slice(0, -1) }));
	}
	async function create(input: CreateEventInput, operationId: string) {
		const run = generation.current;
		const saved = await api.create(input, operationId);
		if (!mounted.current || run !== generation.current) {
			return;
		}
		plans.current = [...plans.current.filter(e => e.id !== saved.id), saved];
		setEvents(plans.current);
		revisions.current.set(saved.id, saved.revision);
		setEventId(saved.id);
		setMessage('Your event is saved. Add your first next step.');
	}
	async function refreshEvent(id: string) {
		if (queues.current.get(id)?.length) {
			throw new Error('Wait for this event to finish saving before refreshing it.');
		}
		const run = generation.current;
		const saved = await api.get(id);
		if (!mounted.current || run !== generation.current) {
			return;
		}
		if (!saved) {
			throw new Error('The event could not be reloaded.');
		}
		if (queues.current.get(id)?.length) {
			throw new Error('New manual edits are protected. Retry refreshing after saving.');
		}
		revisions.current.set(id, saved.revision);
		plans.current = plans.current.map(plan => plan.id === id ? saved : plan);
		setEvents(plans.current);
		setHistory(current => {
			const next = { ...current };
			delete next[id];
			return next;
		});
		setErrors(current => {
			const next = { ...current };
			delete next[id];
			return next;
		});
		setMessage('Reviewed plan saved. Other events stay unchanged.');
	}
	const storageError = loadError || Object.values(errors)[0] || '';
	const studio: Studio | null = event ? {
		events, event, setEventId, update, undo, canUndo: Boolean(history[event.id]?.length),
		apply: () => setMessage('AI revisions will be connected in the next milestone.'),
		rollback: () => { }, hasRollback: false, canRollback: false,
		reset: () => { }, storageError,
		retrySave: () => {
			if (loadError) {
				void load();
				return;
			}
			for (const id of queues.current.keys()) {
				void flush(id);
			}
		},
		message, setMessage,
	} : null;
	return { studio, loading, error: storageError, pending, create, refreshEvent, reload: load, status: storageError ? 'Save needs attention' : pending ? 'Saving...' : 'Saved to your account' };
}
