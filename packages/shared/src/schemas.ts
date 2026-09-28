import { z } from 'zod';

import { EMBED_DIM, FACT_KINDS } from './types';

export const GroupSchema = z.string().regex(/^[A-Za-z0-9:_ \-]{1,96}$/, 'invalid group');

export const SharedFactSchema = z.object({
  kind: z.enum(FACT_KINDS),
  group: GroupSchema,
  key: z.string().min(1).max(64),
  value: z.string().max(64),
  text: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
});

export const RegisterResponseSchema = z.object({
  deviceId: z.string(),
  token: z.string(),
});

export const ContributionRequestSchema = z.object({
  facts: z.array(SharedFactSchema).min(1).max(50),
});

export const ContributionResponseSchema = z.object({
  /** Indexes into the request's `facts` array. */
  accepted: z.array(z.number().int()),
  rejected: z.array(z.object({ idx: z.number().int(), reason: z.string() })),
});

export const KnowledgePointSchema = SharedFactSchema.extend({
  id: z.union([z.string(), z.number()]),
  version: z.number().int(),
  confirmations: z.number().int(),
  vector: z.array(z.number()).length(EMBED_DIM),
  successes: z.number().int(),
  failures: z.number().int(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['verified', 'unverified', 'superseded']),
  superseded_by: z.union([z.string(), z.number()]).optional(),
  last_success_at: z.number().int().optional(),
  observed_at: z.number().int(),
});

export const KnowledgeResponseSchema = z.object({
  points: z.array(KnowledgePointSchema),
  tombstones: z.array(z.union([z.string(), z.number()])),
  /** Version cursor for the next page; null/absent when there is nothing more. */
  next: z.number().int().nullish(),
});

export const HeartbeatSchema = z.object({
  items: z.record(z.string(), z.number().int()).optional(),
  pending: z.number().int().optional(),
  blocked: z.number().int().optional(),
});

export const OutcomeSchema = z.object({
  stop_id: z.string().min(1).max(64),
  place_id: z.string().min(1).max(64),
  result: z.enum(['delivered', 'failed']),
  door_seconds: z.number().int().min(0),
  facts_shown: z.array(z.union([z.string(), z.number()])).max(10),
  at: z.number().int(),
});

export const OutcomeRequestSchema = z.object({
  outcomes: z.array(OutcomeSchema).min(1).max(50),
});

export type SharedFactInput = z.infer<typeof SharedFactSchema>;
export type ContributionRequest = z.infer<typeof ContributionRequestSchema>;
export type ContributionResponse = z.infer<typeof ContributionResponseSchema>;
export type KnowledgeResponse = z.infer<typeof KnowledgeResponseSchema>;
export type OutcomeInput = z.infer<typeof OutcomeSchema>;
export type OutcomeRequest = z.infer<typeof OutcomeRequestSchema>;
