import type { z } from 'zod';
import { notFound } from '../errors';

/** Path ids that do not match their pattern cannot exist: 404, not 400. */
export function idOr404(schema: z.ZodType<string>, value: string, what: string): string {
  const r = schema.safeParse(value);
  if (!r.success) throw notFound(what);
  return r.data;
}
