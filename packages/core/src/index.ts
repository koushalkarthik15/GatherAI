import { planningMetadataSchema } from './planningMetadata.ts';
import { resourceDetailsSchema, sourcingSettingsSchema } from './sourcingSchema.ts';
import { z } from 'zod';

const money = z.number().int().min(0).max(1_000_000_000);
export const taskSchema = z.object({
 id: z.string(), groupId: z.string(), title: z.string().trim().min(1).max(200),
 notes: z.string().max(2000), owner: z.string().max(80), due: z.string(),
 priority: z.enum(['Low', 'Medium', 'High']), status: z.enum(['To do', 'In progress', 'Blocked', 'Done']), dependsOn:z.string().min(1).nullable().optional(),
});
export const eventBriefSchema = z.object({
 durationMinutes:z.number().int().min(1).max(1440).optional(),
 availableResources:z.string().trim().max(400).optional(),
 mustHaves:z.string().trim().max(400).optional(),
 accessibility:z.string().trim().max(400).optional(),
 knownCosts:z.string().trim().max(400).optional(),
}).strict();
export type EventBrief = z.infer<typeof eventBriefSchema>;
export const eventSchema = z.object({
 id: z.string(), name: z.string().min(1), description: z.string(), kind: z.string(),
 date: z.string(), location: z.string(), guests: z.number().int().positive(),
 confirmed: money, pending: money, limit: money, revision: z.number().int().nonnegative(),
 sourcing:sourcingSettingsSchema.optional(),brief:eventBriefSchema.optional(),archived:z.boolean().optional(),planning:planningMetadataSchema.optional(),
 color: z.enum(['cobalt', 'peach', 'lavender']),
 groups: z.array(z.object({ id: z.string(), name: z.string().min(1) })),
 tasks: z.array(taskSchema),
 budget: z.array(z.object({ id: z.string(), name: z.string(), category: z.string(),
  estimate: money, actual: money, committed: z.boolean() })),
 resources: z.array(z.object({ id: z.string(), name: z.string(), source: z.string(),details:resourceDetailsSchema.optional(),
  status: z.enum(['Needed', 'Requested', 'Confirmed', 'Reconfirmation needed']) })),
 agenda: z.array(z.object({ id: z.string(), time: z.string(), title: z.string(), owner: z.string() })),
});
export type EventPlan = z.infer<typeof eventSchema>;
export type Task = z.infer<typeof taskSchema>;
export type BudgetItem = EventPlan['budget'][number];
export const eventsSchema = z.array(eventSchema).min(1);

export * from './rules.ts';
