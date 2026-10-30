import type { Dispatch, SetStateAction } from 'react';
import type { EventPlan } from '@gather/core';

/** Shared workspace contract implemented by demo storage and account storage. */
export interface Studio {
	events: EventPlan[];
	event: EventPlan;
	setEventId: Dispatch<SetStateAction<string>>;
	update(next: EventPlan, label: string): boolean;
	undo(): void;
	canUndo: boolean;
	apply(next: EventPlan): void;
	rollback(): void;
	hasRollback: boolean;
	canRollback: boolean;
	reset(): void;
	storageError: string;
	retrySave(): void;
	message: string;
	setMessage: Dispatch<SetStateAction<string>>;
}
