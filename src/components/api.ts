// Browser-side helper: POST JSON, return an error message (or null).
export async function postJson(path: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string }).error ?? `HTTP ${r.status}` };
  } catch { return { ok: false, error: 'Could not reach the server.' }; }
}
