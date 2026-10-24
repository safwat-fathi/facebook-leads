// Apify actor runs behind an interface (tests use a fake). Cost comes from Apify itself, never from our estimates.
import 'server-only';
import { ApifyClient } from 'apify-client';

export type RunResult = { items: Record<string, unknown>[]; costUsd: number; runId: string };
export interface ApifyPort {
  run(actor: string, input: Record<string, unknown>, o: { maxChargeUsd: number; signal?: AbortSignal; onStarted?: (runId: string) => void }): Promise<RunResult>;
  abort(runId: string): Promise<void>;
}
const DONE = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// What a run has charged. Apify's usage total and its charged-event counters both trail the end of the run (measured: counters by ~4 s, the
// usage total by ~7 s, longer for more events), so a single read under-reports; the larger of the two is the best figure at any moment.
type RunInfo = { usageTotalUsd?: number; chargedEventCounts?: Record<string, number>; pricingInfo?: unknown }; // pricingInfo is a union in the SDK; only pay-per-event carries prices
type EventPrices = { pricingPerEvent?: { actorChargeEvents?: Record<string, { eventPriceUsd?: number }> } };
const eventsUsd = (r: RunInfo) => Object.entries(r.chargedEventCounts ?? {}).reduce((s, [e, n]) => s + n * ((r.pricingInfo as EventPrices | undefined)?.pricingPerEvent?.actorChargeEvents?.[e]?.eventPriceUsd ?? 0), 0);
export const chargedUsd = (r: RunInfo) => Math.max(r.usageTotalUsd ?? 0, eventsUsd(r));

/** Read a finished run's cost until it is settled: the usage total has caught up with the events and three reads in a row agree. */
export async function settledCost(read: () => Promise<RunInfo | undefined>, wait: (ms: number) => Promise<unknown> = sleep): Promise<number> {
  let best = 0, steady = 0;
  for (let i = 1; i <= 15; i++) { // at most ~30 s
    try {
      const r = (await read()) ?? {};
      const cost = chargedUsd(r);
      steady = (r.usageTotalUsd ?? 0) >= eventsUsd(r) - 1e-9 && cost === best ? steady + 1 : 0;
      best = Math.max(best, cost);
    } catch { steady = 0; } // a failed read must not lose what we already know
    if (steady >= 3 || (best === 0 && i >= 3)) break; // settled, or nothing was ever charged
    await wait(2000);
  }
  return best;
}

export function apifyPort(token: string): ApifyPort {
  const client = new ApifyClient({ token });
  return {
    async run(actor, input, o) {
      const started = await client.actor(actor).start(input, { maxTotalChargeUsd: o.maxChargeUsd });
      o.onStarted?.(started.id);
      const stop = () => { void client.run(started.id).abort().catch(() => {}); };
      o.signal?.addEventListener('abort', stop, { once: true });
      try {
        let run = started;
        while (!DONE.has(run.status)) {
          if (o.signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
          run = await client.run(started.id).waitForFinish({ waitSecs: 10 });
        }
        if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.status.toLowerCase()}`);
        const { items } = await client.dataset(run.defaultDatasetId).listItems({ limit: 1000 });
        return { items: items as Record<string, unknown>[], costUsd: await settledCost(() => client.run(started.id).get()), runId: started.id };
      } catch (e) {
        // A run that failed or was cancelled has usually charged already: put what it cost on the error so the caller can still ledger it.
        const costUsd = await settledCost(() => client.run(started.id).get()).catch(() => 0);
        throw Object.assign(e instanceof Error ? e : new Error(String(e)), { costUsd });
      } finally { o.signal?.removeEventListener('abort', stop); }
    },
    async abort(runId) { await client.run(runId).abort(); },
  };
}
