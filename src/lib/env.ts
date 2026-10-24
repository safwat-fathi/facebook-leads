import 'server-only';
import { z } from 'zod';

// Read lazily so `next build` and tests don't need every secret. Server-only: nothing here may reach the browser bundle.
// An empty line (`APIFY_TOKEN=` in .env, as in .env.example) means "not set", not "invalid".
const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional());
const Env = z.object({
  APP_API_KEY_HASH: z.string().regex(/^[0-9a-f]{64}$/, 'APP_API_KEY_HASH must be a sha256 hex digest (run pnpm run gen-key)'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters (run pnpm run gen-key)'),
  APP_ORIGIN: z.url('APP_ORIGIN must be the public URL, e.g. https://leads.example.com').transform((u) => new URL(u).origin),
  APIFY_TOKEN: optional,
  OPENROUTER_API_KEY: optional,
  AGENT_MODEL: z.string().min(1).default('anthropic/claude-haiku-5.5'),
  DATA_DIR: z.string().min(1).default('./data'),
  MAX_JOB_USD: z.coerce.number().positive().default(3),
  DAILY_BUDGET_USD: z.coerce.number().positive().default(10),
});
export type AppEnv = z.infer<typeof Env>;

let cached: AppEnv | null = null;
export function getEnv(): AppEnv {
  if (cached) return cached;
  const r = Env.safeParse(process.env);
  if (!r.success) throw new Error(`Invalid environment:\n${r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  return (cached = r.data);
}
export const resetEnvForTests = () => { cached = null; };
export const isProd = () => process.env.NODE_ENV === 'production';
