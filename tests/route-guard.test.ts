// A new route or page cannot ship unguarded: this reads the source tree and fails if one is missing its guard.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..', 'src', 'app');
const files = (name: RegExp) => (readdirSync(APP, { recursive: true }) as string[]).filter((f) => name.test(f)).map((f) => f.split('\\').join('/'));
const PUBLIC_ROUTES = ['api/login/route.ts', 'api/logout/route.ts'];

describe('route handlers', () => {
  const routes = files(/(^|\/)route\.ts$/);
  it('there are routes to check', () => expect(routes.length).toBeGreaterThan(2));
  it.each(routes)('%s exports only guarded handlers', (file) => {
    const src = readFileSync(join(APP, file), 'utf8');
    const exports = [...src.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b([^\n]*)/g)];
    expect(exports.length).toBeGreaterThan(0);
    for (const [, method, rest] of exports) {
      expect(rest, `${file} ${method} must be exported as withAuth(...) or publicRoute(...)`).toMatch(/=\s*(withAuth|publicRoute)(<[^>]*>)?\(/);
      if (PUBLIC_ROUTES.includes(file)) expect(rest).toMatch(/publicRoute(<[^>]*>)?\(/);
      else expect(rest, `${file} is not on the public allow-list, so it must use withAuth`).toMatch(/withAuth(<[^>]*>)?\(/);
    }
  });
});

describe('pages', () => {
  const pages = files(/(^|\/)page\.tsx$/).filter((f) => f !== 'login/page.tsx');
  it('there are pages to check', () => expect(pages.length).toBeGreaterThan(0));
  it.each(pages)('%s calls requireAuth() before reading data', (file) => {
    const src = readFileSync(join(APP, file), 'utf8');
    expect(src).toMatch(/await requireAuth\(\)/);
    const at = src.indexOf('await requireAuth()');
    for (const dataCall of ['queryPages(', 'pageDetail(', 'listJobs(', 'getJob(', 'stats(', 'facets(']) {
      const i = src.indexOf(dataCall);
      if (i >= 0) expect(at, `${file}: requireAuth() must come before ${dataCall}`).toBeLessThan(i);
    }
  });
});

describe('untrusted HTML', () => {
  it('no component or page uses dangerouslySetInnerHTML or innerHTML', () => {
    const all = (readdirSync(join(__dirname, '..', 'src'), { recursive: true }) as string[]).filter((f) => /\.(tsx?|jsx?)$/.test(f));
    for (const f of all) expect(readFileSync(join(__dirname, '..', 'src', f), 'utf8'), f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML/);
  });
});
