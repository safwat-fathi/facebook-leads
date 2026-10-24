import { bad } from './errors';

/** Read a small JSON body (size-capped); throws a 400 on anything else. */
export async function readJson(req: Request, max = 20_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > max) throw bad('request too large');
  try { return JSON.parse(text); } catch { throw bad('invalid JSON'); }
}
export function jobId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw bad('invalid job id');
  return n;
}
