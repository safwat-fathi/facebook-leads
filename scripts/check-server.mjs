// End-to-end security check against the PRODUCTION build (`pnpm build` first): node scripts/check-server.mjs  (or: pnpm run check:server)
// Starts .next/standalone/server.js on a random port with a throwaway copy of the database and sentinel secrets.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

if (!existsSync('.next/standalone/server.js')) throw new Error('run `pnpm build` first');
const dir = mkdtempSync(join(tmpdir(), 'fbl-check-'));
if (existsSync('data/leads.db')) { // a consistent copy (VACUUM INTO) of the pages only: real jobs, spend and signals would change what the checks below expect
  const src = new DatabaseSync('data/leads.db');
  src.exec(`vacuum into '${join(dir, 'leads.db').replace(/'/g, "''")}'`); src.close();
  const copy = new DatabaseSync(join(dir, 'leads.db'));
  for (const t of ['signals', 'jobs', 'spend']) try { copy.exec(`delete from ${t}`); } catch { /* table not created yet in an older database */ }
  copy.close();
}
const PORT = 42000 + Math.floor(Math.random() * 1000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const KEY = 'fbl_' + randomBytes(32).toString('base64url');
const SENTINEL_APIFY = 'apify_api_SENTINEL_' + randomBytes(8).toString('hex');
const SENTINEL_OR = 'sk-or-SENTINEL_' + randomBytes(8).toString('hex');
const HASH = createHash('sha256').update(KEY).digest('hex');
const SECRET = randomBytes(48).toString('base64url');

const server = spawn(process.execPath, ['--no-warnings', '.next/standalone/server.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), HOSTNAME: '127.0.0.1', DATA_DIR: dir, APP_ORIGIN: ORIGIN, APP_API_KEY_HASH: HASH, SESSION_SECRET: SECRET, APIFY_TOKEN: SENTINEL_APIFY, OPENROUTER_API_KEY: SENTINEL_OR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
const bodies = []; // every response body, scanned for secrets at the end
const get = async (path, init = {}) => { const r = await fetch(ORIGIN + path, { redirect: 'manual', ...init }); const text = await r.text(); bodies.push(text); return { r, text }; };
const post = (path, body, headers = {}) => get(path, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(ORIGIN + '/login')).status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 500)); if (i === 59) throw new Error('server did not start:\n' + log); }

  // 1. nothing is reachable without a session
  let x = await get('/');
  assert.equal(x.r.status, 307); assert.match(x.r.headers.get('location'), /\/login$/);
  for (const [path, init] of [['/api/export'], ['/api/pages/100', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{"stage":"new"}' }]]) {
    assert.equal((await get(path, init)).r.status, 401, `${path} must be 401 without a session`);
  }
  x = await get('/', { headers: { cookie: '__Host-fbl_session=v1.forged.forged' } }); // cookie present but invalid: the page itself must refuse
  assert.equal(x.r.status, 307);
  assert.equal((await get('/', { headers: { cookie: '__Host-fbl_session=v1.e30.AAAA' } })).r.status, 307);

  // 2. login page: CSP nonce + security headers
  x = await get('/login');
  assert.equal(x.r.status, 200);
  const csp = x.r.headers.get('content-security-policy');
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, 'CSP carries a nonce'); assert.ok(x.text.includes(`nonce="${nonce}"`), 'scripts carry the same nonce');
  assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/); assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
  assert.equal(x.r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(x.r.headers.get('x-frame-options'), 'DENY'); assert.equal(x.r.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(!x.r.headers.get('x-powered-by'));
  const nonce2 = (await get('/login')).r.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
  assert.notEqual(nonce, nonce2, 'a fresh nonce per request');

  // 3. login
  assert.equal((await post('/api/login', { key: 'fbl_wrong' })).r.status, 401);
  assert.equal((await post('/api/login', { key: KEY }, { origin: 'https://evil.example' })).r.status, 403);
  x = await post('/api/login', { key: KEY });
  assert.equal(x.r.status, 200);
  const setCookie = x.r.headers.get('set-cookie');
  assert.match(setCookie, /^__Host-fbl_session=/); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /Secure/i); assert.match(setCookie, /SameSite=strict/i); assert.match(setCookie, /Path=\//i); assert.doesNotMatch(setCookie, /Domain=/i);
  const cookie = setCookie.split(';')[0];
  const authed = { cookie };

  // 4. signed in: the leads page, filters, drawer
  x = await get('/', { headers: authed });
  assert.equal(x.r.status, 200); assert.match(x.text, /pages\./);
  const total = Number(x.text.match(/<b>(\d[\d,]*)<\/b> pages\./)?.[1]?.replace(/,/g, ''));
  assert.ok(total >= 1, 'summary shows the page count');
  x = await get('/?min-followers=notanumber', { headers: authed });
  assert.equal(x.r.status, 200); assert.match(x.text, /Invalid filter/); // a clear message, not a 500
  x = await get(`/?q=${encodeURIComponent("'; drop table pages; --")}`, { headers: authed });
  assert.equal(x.r.status, 200); assert.doesNotMatch(x.text, /Invalid filter/); assert.match(x.text, /No pages match these filters/); // text, not SQL
  assert.equal(Number((await get('/', { headers: authed })).text.match(/<b>(\d[\d,]*)<\/b> pages\./)[1].replace(/,/g, '')), total, 'table survived the injection attempt');
  const id = x.text.match(/data-open-id="(\d+)"/)?.[1] ?? (await get('/', { headers: authed })).text.match(/data-open-id="(\d+)"/)?.[1];
  assert.ok(id, 'rows link to a page id');
  x = await get(`/?open=${id}`, { headers: authed });
  assert.match(x.text, /<dialog/); assert.match(x.text, /Your review/);
  assert.doesNotMatch(x.text, /token=eyJ/, 'signed WhatsApp link tokens must not be rendered');

  // 5. writes: same-origin only
  assert.equal((await post(`/api/pages/${id}`, { stage: 'reviewed' }, { ...authed, origin: 'https://evil.example' })).r.status, 403);
  assert.equal((await post(`/api/pages/${id}`, { stage: 'reviewed' }, { ...authed, 'sec-fetch-site': 'cross-site' })).r.status, 403);
  assert.equal((await post(`/api/pages/${id}`, { stage: 'bogus' }, authed)).r.status, 400);
  x = await post(`/api/pages/${id}`, { stage: 'reviewed', notes: 'ملاحظة' }, authed);
  assert.equal(x.r.status, 200); assert.equal(JSON.parse(x.text).stage, 'reviewed'); assert.ok(!('raw' in JSON.parse(x.text)));
  assert.match((await get(`/?open=${id}`, { headers: authed })).text, /ملاحظة/);

  // 6. export
  x = await get('/api/export', { headers: authed });
  assert.equal(x.r.status, 200); assert.match(x.r.headers.get('content-type'), /text\/csv/); assert.match(x.r.headers.get('content-disposition'), /attachment/);
  assert.doesNotMatch(x.text, /token=/);

  // 6b. jobs: guarded, validated, budget-capped
  for (const [path, init] of [["/api/jobs"], ["/api/jobs/1"], ["/api/jobs/estimate", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" }], ["/api/jobs", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" }], ["/api/jobs/1/cancel", { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: "{}" }]]) {
    assert.equal((await get(path, init)).r.status, 401, `${path} must be 401 without a session`);
  }
  assert.equal((await get("/jobs")).r.status, 307);
  const discoverBody = { kind: "discover", params: { terms: ["ملابس حريمي", "عطور"], locations: ["Cairo, Egypt"], perSearch: 20 } };
  x = await post("/api/jobs/estimate", discoverBody, authed);
  assert.equal(x.r.status, 200); assert.ok(Math.abs(JSON.parse(x.text).usd - 2 * (20 * 0.012 + 0.001)) < 1e-9, "estimate = searches x (results x $0.012 + $0.001)");
  assert.match(JSON.parse((await post("/api/jobs/estimate", { kind: "discover", params: { terms: [], locations: ["x"], perSearch: 20 } }, authed)).text).error, /terms/);
  x = await post("/api/jobs", { ...discoverBody, budgetUsd: 50 }, authed);
  assert.equal(x.r.status, 400); assert.match(JSON.parse(x.text).error, /per-job limit/); // refused before anything runs or is spent
  assert.equal((await post("/api/jobs", discoverBody, { ...authed, origin: "https://evil.example" })).r.status, 403);
  assert.equal((await get("/api/jobs/999999", { headers: authed })).r.status, 404);
  assert.equal((await get("/api/jobs/abc", { headers: authed })).r.status, 400);
  assert.equal((await post("/api/jobs/999999/cancel", {}, authed)).r.status, 404);
  assert.equal((await get("/jobs/999999", { headers: authed })).r.status, 404);
  x = await get("/jobs", { headers: authed });
  assert.equal(x.r.status, 200); assert.match(x.text, /Find new pages/); assert.match(x.text, /daily limit/);

  // live and free: a website check through the real worker + SSRF-guarded fetch. Cairo Sales answers bots with a Cloudflare 403,
  // which must still count as "has a website".
  const cairo = (await get("/?q=Cairo+Sales", { headers: authed })).text.match(/data-open-id="(\d+)"/)?.[1];
  if (cairo) {
    x = await post("/api/jobs", { kind: "website_check", params: { filters: { q: "Cairo Sales" }, limit: 1, recheck: true }, budgetUsd: 0.05 }, authed);
    assert.equal(x.r.status, 201);
    const jobId = JSON.parse(x.text).id;
    let job;
    for (let i = 0; i < 90; i++) { job = JSON.parse((await get(`/api/jobs/${jobId}`, { headers: authed })).text); if (!["queued", "running"].includes(job.status)) break; await new Promise((r) => setTimeout(r, 1000)); }
    assert.equal(job.status, "done", "the worker ran the job: " + JSON.stringify(job));
    assert.equal(job.spent_usd, 0, "a listed-site check costs nothing");
    const page = (await get(`/?open=${cairo}`, { headers: authed })).text;
    if (/blocked to bots/.test(page)) console.log("  live check: Cairo Sales Store -> has a website (blocked to bots), as expected");
    else if (/unreachable|Dead domain/.test(page)) console.log("  live check skipped: this machine could not reach cairosales.com (offline?)");
    else assert.fail("Cairo Sales Store must come out as having a website; page said: " + (page.match(/Website[^<]{0,40}/g) ?? []).join(" | "));
  }

  // 6c. the paid paths in the PRODUCTION bundle, with bogus tokens: they must reach the network, fail cleanly, and cost nothing.
  //     (this has never run inside the standalone build otherwise: apify-client and the OpenRouter call)
  const waitJob = async (id) => { let j; for (let i = 0; i < 120; i++) { j = JSON.parse((await get(`/api/jobs/${id}`, { headers: authed })).text); if (!["queued", "running"].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 1000)); } return j; };
  x = await post("/api/jobs", { kind: "discover", params: { terms: ["a1", "a2", "a3", "a4"], locations: ["Cairo, Egypt"], perSearch: 5 }, budgetUsd: 0.5 }, authed);
  assert.equal(x.r.status, 201);
  let j = await waitJob(JSON.parse(x.text).id);
  assert.equal(j.status, "failed", "a discover job with a bogus Apify token must fail: " + JSON.stringify(j).slice(0, 400));
  assert.match(j.error, /Three searches in a row failed/);
  assert.equal(j.spent_usd, 0);
  assert.ok(!/Cannot find module|is not a function|is not defined|Module not found/i.test(j.log), "the log shows an Apify/network error, not a bundling error:\n" + j.log);
  assert.match(j.log, /failed \(/);
  const golden = (await get("/?q=Golden", { headers: authed })).text.match(/data-open-id="(\d+)"/)?.[1];
  if (golden) {
    x = await post("/api/jobs", { kind: "website_check", params: { filters: { q: "Golden" }, limit: 1, recheck: true }, budgetUsd: 0.1 }, authed);
    assert.equal(x.r.status, 201, x.text);
    j = await waitJob(JSON.parse(x.text).id);
    assert.equal(j.status, "done"); assert.equal(j.spent_usd, 0);
    assert.match(j.log, /failed \(/, "the agent page fails visibly with a bogus OpenRouter token:\n" + j.log);
    assert.ok(!/Cannot find module|is not a function|is not defined|Module not found/i.test(j.log), "no bundling error:\n" + j.log);
    assert.match((await get(`/?open=${golden}`, { headers: authed })).text, /(Not checked yet|not checked)/i); // a failed attempt saves nothing
    console.log("  paid paths with bogus tokens: failed cleanly, $0 spent, nothing saved");
  }

  // 6d. enrichment in the production bundle with a bogus Apify token: fails cleanly, costs nothing, saves nothing
  x = await post('/api/jobs/estimate', { kind: 'enrich', params: { filters: {}, limit: 50, recheck: false } }, authed);
  assert.equal(x.r.status, 200); assert.ok(JSON.parse(x.text).usd > 0);
  x = await post('/api/jobs', { kind: 'enrich', params: { filters: {}, limit: 50, recheck: false }, budgetUsd: 3 }, authed);
  assert.equal(x.r.status, 201, x.text);
  j = await waitJob(JSON.parse(x.text).id);
  assert.equal(j.status, 'failed'); assert.match(j.error, /Three batches in a row failed/); assert.equal(j.spent_usd, 0);
  assert.ok(!/Cannot find module|is not a function|is not defined|Module not found/i.test(j.log), 'no bundling error:\n' + j.log);
  assert.match((await get('/', { headers: authed })).text, /<b>0<\/b> have posts and ads data/);
  assert.match((await get('/?signal=inbox&enriched=yes', { headers: authed })).text, /No pages match/);
  assert.equal((await get('/?signal=bogus', { headers: authed })).text.includes('Signal is not one of the available options'), true);
  console.log('  enrichment with a bogus token: failed cleanly, $0 spent, nothing saved');

  // 7. logout clears it
  x = await post('/api/logout', {}, authed);
  assert.match(x.r.headers.get('set-cookie'), /Max-Age=0/i);

  // 8. no secret anywhere the browser can see
  for (const b of bodies) for (const s of [SENTINEL_APIFY, SENTINEL_OR, SECRET, HASH, KEY]) assert.ok(!b.includes(s), 'a secret appeared in a response body');
  const walk = (d) => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));
  for (const f of walk('.next/static')) { const t = readFileSync(f, 'utf8'); for (const s of [SENTINEL_APIFY, SENTINEL_OR, 'APIFY_TOKEN', 'OPENROUTER_API_KEY', 'APP_API_KEY_HASH', 'SESSION_SECRET']) assert.ok(!t.includes(s), `${s} found in client bundle ${f}`); }
  console.log(`server check ok (${bodies.length} responses scanned, ${walk('.next/static').length} client files scanned)`);
} catch (e) {
  console.error(e); console.error('--- server log:\n' + log.slice(-2000)); process.exitCode = 1;
} finally { server.kill(); }
