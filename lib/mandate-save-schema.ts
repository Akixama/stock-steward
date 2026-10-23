import { z } from 'zod';
import { editableLimitsValid } from './editable-limits.ts';

// Validate the HTTP body independently of the form; an API caller cannot bypass
// the release ceiling by sending a larger number directly.
export const mandateSaveSchema = z.object({
  baseVersion: z.number().int().min(0),
  allowedSymbols: z.array(z.string().regex(/^[A-Z.]{1,8}$/)).max(32),
  maxOrderCents: z.number().int().positive().safe(),
  maxDailyBuyCents: z.number().int().positive().safe(),
  maxPositionBps: z.number().int().min(1).max(10_000),
  executionPreference: z.enum(['approval', 'automatic']),
}).strict().refine(value => editableLimitsValid(value.maxOrderCents, value.maxDailyBuyCents));

export async function parseMandateSaveRequest(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return null; }
  return mandateSaveSchema.safeParse(body);
}
