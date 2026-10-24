import { describe, expect, it } from 'vitest';
import { chargedUsd, settledCost } from '@/lib/apify';

type Run = Parameters<typeof chargedUsd>[0];

// Shapes and timings seen in the paid test of 2026-10-24: right after a run ends, Apify's event counters and then its usage total are still
// catching up (a 2-post run read post:0, then post:2 about 4 s later, and usageTotalUsd only reached $0.011 about 7 s later).
const PRICING = { pricingPerEvent: { actorChargeEvents: { post: { eventPriceUsd: 0.005 }, 'actor-start': { eventPriceUsd: 0.001 } } } };
const info = (usage: number, post: number) => ({ usageTotalUsd: usage, chargedEventCounts: { post, 'actor-start': 1 }, pricingInfo: PRICING });
const nowait = async () => {};
function reader(seq: (Run | Error)[]) {
  let reads = 0;
  const read = async () => { const r = seq[Math.min(reads++, seq.length - 1)]; if (r instanceof Error) throw r; return r; };
  return { read, reads: () => reads };
}

describe('chargedUsd', () => {
  it('is the larger of the usage total and the event counters', () => {
    expect(chargedUsd(info(0.121, 40))).toBeCloseTo(0.201, 6); // the live run: usage said 0.121 while 40 posts had been charged
    expect(chargedUsd(info(0.3, 2))).toBeCloseTo(0.3, 6);
    expect(chargedUsd({})).toBe(0);
  });
});

describe('settledCost', () => {
  it('waits for the usage total to catch up with the events, then for it to stop moving', async () => {
    const r = reader([info(0, 0), info(0.001, 0), info(0.001, 2), info(0.011, 2)]);
    expect(await settledCost(r.read, nowait)).toBeCloseTo(0.011, 6);
    expect(r.reads()).toBe(6); // 0.011 had to be seen three times in a row
  });
  it('does not trust the first reading (the bug: a single read 3.5 s after the end returned 0.121 instead of 0.201)', async () => {
    const r = reader([info(0.121, 40), info(0.201, 40)]);
    expect(await settledCost(r.read, nowait)).toBeCloseTo(0.201, 6);
  });
  it('returns 0 quickly when nothing was ever charged (a run cancelled before it started)', async () => {
    const r = reader([{ usageTotalUsd: 0, chargedEventCounts: {}, pricingInfo: PRICING }]);
    expect(await settledCost(r.read, nowait)).toBe(0);
    expect(r.reads()).toBe(3);
  });
  it('gives up after a bounded number of reads and reports the highest figure seen', async () => {
    let n = 0;
    const read = async () => info(0.001 * ++n, 0);
    expect(await settledCost(read, nowait)).toBeCloseTo(0.015, 6);
    expect(n).toBe(15);
  });
  it('survives a failed read without losing the figure', async () => {
    const r = reader([info(0.201, 40), new Error('network'), info(0.201, 40)]);
    expect(await settledCost(r.read, nowait)).toBeCloseTo(0.201, 6);
  });
});
