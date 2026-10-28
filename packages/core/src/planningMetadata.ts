import { z } from 'zod';
const money=z.number().int().min(0).max(1_000_000_000);
const guests=z.number().int().min(1).max(100000);
/** Explicit metadata only. Missing entries preserve legacy manual/fixed behavior. */
export const planningMetadataSchema=z.object({
 capacity:guests.optional(),
 budget:z.array(z.discriminatedUnion('basis',[
  z.object({id:z.string().min(1),basis:z.literal('fixed')}).strict(),
  z.object({id:z.string().min(1),basis:z.literal('manual')}).strict(),
  z.object({id:z.string().min(1),basis:z.literal('per_attendee'),unitCost:money}).strict(),
 ])).max(100).default([]),
 tasks:z.array(z.object({
  id:z.string().min(1),deadlineMode:z.enum(['fixed','event_relative']),
 }).strict()).max(500).default([]),
}).strict();
export type PlanningMetadata=z.infer<typeof planningMetadataSchema>;
