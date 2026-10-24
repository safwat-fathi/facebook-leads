'use client';
import { useEffect, useState } from 'react';
import { postJson } from './api';

export type Estimate = { usd: number; suggestedBudgetUsd: number; detail: Record<string, number>; budget: { spent24h: number; dailyLimit: number; maxJob: number; available: number } };
/** Asks the server what a job would cost, 400 ms after the inputs stop changing. `body` null = not ready. */
export function useEstimate(body: unknown | null) {
  const [est, setEst] = useState<Estimate | null>(null);
  const [error, setError] = useState('');
  const key = JSON.stringify(body);
  useEffect(() => {
    if (body === null) { setEst(null); setError(''); return; }
    let stale = false;
    const t = setTimeout(async () => {
      const r = await postJson('/api/jobs/estimate', body);
      if (stale) return;
      if (r.ok) { setEst(r.data as Estimate); setError(''); } else { setEst(null); setError(r.error); }
    }, 400);
    return () => { stale = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { est, error };
}
