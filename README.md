# Egyptian seller leads

A private web app for finding Egyptian Facebook pages that sell online, checking whether each has its own website, and tracking them as leads. One user, one shared API key, hosted on your own server.

- **Leads**: filter, sort and review the pages you have (followers, location, business type, WhatsApp, website status, stage), add notes, mark real sellers, export CSV.
- **Find new pages**: a search by keyword and city (Apify) that saves every page it finds.
- **Check websites**: for the pages in your current filter, checks the site Facebook lists (free) or asks an AI agent to search the web for one (Apify Google search + OpenRouter model).
- **Enrich**: reads each page’s recent posts and ads and keeps simple signals (orders by message, cash on delivery, existing order link, posting frequency, ads with message buttons). These feed the **Fit** score.
- **Fit**: two scores per page (web shop, WhatsApp automation) with the reasons behind every point, a pitch label, and a Fit filter and sort.
- **Budgets**: every search shows a cost estimate first and has a hard budget; there is a per-job and a daily limit.

What is built and what comes next: see [../ROADMAP.md](../ROADMAP.md). Deploying: see [DEPLOY.md](DEPLOY.md). This file covers using and developing the app.

## Quick start (local)

Requires Node 22.19+ and pnpm.

```sh
pnpm install
cp .env.example .env.local     # set APP_ORIGIN=http://localhost:3000
pnpm run gen-key               # prints your API key ONCE, plus APP_API_KEY_HASH and SESSION_SECRET
# paste the two values into .env.local; keep the key somewhere safe
mkdir -p data
pnpm dev                       # http://localhost:3000, sign in with the key
```

## Configuration (`.env` / `.env.local`)

| Variable | Required | Meaning |
|---|---|---|
| `APP_ORIGIN` | yes | Public URL, `https://...` with no trailing slash. Used for the cross-site request check, so it must match the browser's address. |
| `APP_API_KEY_HASH` | yes | SHA-256 of the API key (from `gen-key`). The key itself is never stored. |
| `SESSION_SECRET` | yes | Signs the session cookie (32+ chars). Changing it signs everyone out. |
| `APIFY_TOKEN` | for searches | Used by Find new pages and the agent's Google search. Empty disables them. |
| `OPENROUTER_API_KEY` | for the agent | Used for the model that looks for websites. Empty disables the agent (free checks still work). |
| `AGENT_MODEL` | no | Default `anthropic/claude-haiku-5.5`. |
| `MAX_JOB_USD` | no | Largest budget one job may have. Default 3. |
| `DAILY_BUDGET_USD` | no | Total across jobs in any rolling 24 h. Default 10. |
| `DATA_DIR` | no | Where `leads.db` lives. Default `./data`. |

Secrets go in `.env`/`.env.local` only (both git-ignored), never in `.env.example`.

## Using it

### Leads
Filters live in the URL, so any view can be bookmarked. Click a page name to open its details: how we know it is in Egypt, its WhatsApp number (*linked on the page* is reliable; *mobile guess* is just its listed mobile), the website evidence, and your stage, notes and ✓/✗ mark.

**Website status meanings**

| Status | Counts as "has a website"? |
|---|---|
| Website, verified / not matched / blocked to bots | Yes. *Blocked* means the site answers bots with a 403 (e.g. Cloudflare); it exists. |
| Website found | Yes (found by search, tied to the page by phone or link). |
| Possible website, Website unreachable, Dead domain | No, review by hand. |
| No website found | Searches found none. This is not proof it has none. |

### Find new pages (Jobs)
Enter one search term per line (presets add Arabic examples), pick up to 3 cities, results per search (5-40), and a budget. Cost is about `searches x (results x $0.012 + $0.001)`. Pages already in the database are updated, never duplicated or overwritten (your notes and stage are kept). Use **View pages found** on the job to see only that search's results.

### Check websites
On the Leads page, **Check websites...** acts on the pages in your current filter that have no result yet, biggest first. Choose how many (1-50) and a budget. Listed sites cost nothing; each page that needs the agent costs about $0.025.

### Enrich
On the Leads page, **Enrich...** reads the 8 most recent posts of each page in your current filter (five pages per Apify run) and, only for pages Facebook says run ads, up to 3 active ads. Measured cost is about $0.045 per page ($0.005 per post, $0.0058 per ad result including the empty placeholder Apify returns for a page with no active ad, and a $0.001 start fee per run). Pages that return no posts (private or empty) are still marked enriched so they are not paid for twice; tick "check again" to redo them.

Signals shown as tags in the table and filterable: *orders by message* (price or order goes through DMs), *cash on delivery*, *order link* (the seller already sells through a website, so a poorer web-shop prospect), *posts often* (4+ in 30 days), *runs ads* and *message ads* (ad button says Message or WhatsApp). Only counts and up to 3 short quotes of the business’s own posts are stored: no commenter names, no media.

### Fit (scoring)
Every page gets two scores out of 100, computed on the fly from what is stored (free, no model): **web shop** (a seller without a site who takes orders by message, posts often, runs ads) and **WhatsApp automation** (many comments, a Message or WhatsApp ad button, WhatsApp linked on the page, orders by message). A side *counts* at 50 or more, which gives the pitch: *Web shop*, *WhatsApp*, *Both* or *Skip*. A page whose website has not been checked (or needs a look) is never skipped for that: if "no website found" would lift its shop score to 50, it reads *Check website* instead. Open a page to see every reason with its points, and what could not be judged (for example "Website not checked yet").

- A page whose posts have not been read has **no pitch yet** (its provisional scores are shown, and it sorts after scored pages). Enrich it first.
- **Skipped regardless of signals:** a page you marked as not a real seller, a page outside Egypt, and a page whose last post is more than 90 days old (abandoned).
- An existing order link in the posts lowers the web-shop score: that seller already has a checkout.
- The ad library lookup, when it worked, wins over Facebook's own "running ads" flag.
- Sort by **Fit** (best score first) and filter by **Fit** (Web shop includes Both). The same filter applies to the CSV and to Enrich/Check jobs.
- **The weights are first guesses.** They live in one object in `src/lib/score.ts` (`WEIGHTS`, `THRESHOLD`) and are pinned by `tests/score.test.ts`, so retune both together. Scoring ranks fit, not willingness to pay.

### Jobs
One job runs at a time. After each Apify run the app waits (about 8 to 10 seconds, up to 30) for Apify to settle the charge, because the figure it reports right after a run ends is too low; budgets and the daily limit use the settled figure. A run that fails or is cancelled is charged too. Progress updates live; **Cancel** stops a running job and its Apify run. If the server restarts mid-job, the job is marked failed and its runs are aborted.

## Security model
- Login by API key; session is a signed `HttpOnly`, `SameSite=Strict` cookie (`__Host-` and `Secure` in production). Login attempts are throttled.
- Every page and API route checks the session itself (`requireAuth()` / `withAuth()`); a test fails if a new route skips it.
- Mutating requests must come from `APP_ORIGIN`.
- Strict CSP with a per-request nonce; Facebook text is always rendered as plain text and only `http(s)` links are clickable.
- The server fetches URLs that page owners control, so all fetching goes through an SSRF guard (public addresses only, ports 80/443, checked at connect time and on every redirect, size and time limits).
- API tokens stay on the server and never reach the browser bundle.

## Development

```sh
pnpm test                         # unit and integration tests (no network, no money)
pnpm run typecheck
pnpm build && pnpm run check:server   # end-to-end security checks on the production build
pnpm run backup                   # consistent copy of the database to data/backups
```

`check:server` runs a free live check against two real sites and a discover/agent run with fake tokens; it spends nothing.

### Layout
```
src/app/          pages and API routes (login, leads, jobs)
src/components/   client components (filters, drawer, job forms)
src/lib/          parse.ts (record parsing), signals.ts (posts/ads to signals), filters.ts, pages.ts (queries), jobs.ts (queue, budgets, worker),
                  website-agent.ts, safe-fetch.ts (SSRF guard), auth.ts, apify.ts, llm.ts
src/proxy.ts      redirect to login + CSP nonce
src/instrumentation.ts   starts the job worker
tests/            vitest
scripts/          gen-key, backup, production-build check
```

## Limits
- One process and one SQLite writer: fine for one user on one server.
- One shared key; no per-person accounts or audit trail.
- Login throttle memory resets on restart.
- A server restart aborts a running job's Apify runs but does not ledger what they had charged by then (a few cents at most); check the Apify console after a restart mid-job.
- The database holds sole traders' phone numbers and emails. Keep the server and backups private. Contacting these businesses is regulated (Egypt Law 151/2020); get Egyptian legal advice before any outreach. The app does not send messages.
