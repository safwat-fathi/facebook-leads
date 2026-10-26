// Browser-side helpers: send JSON, get back the parsed answer or an error message.
async function sendJson(method: string, path: string, body: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string }).error ?? `HTTP ${r.status}` };
  } catch { return { ok: false, error: 'Could not reach the server.' }; }
}
export const postJson = (path: string, body: unknown) => sendJson('POST', path, body);
export const patchJson = (path: string, body: unknown) => sendJson('PATCH', path, body);
