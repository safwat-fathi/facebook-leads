# Roadmap and progress

Goal: find Egyptian Facebook pages that sell online, see which have no real shop or WhatsApp automation, and (later) contact them.
Services pitched: **web shop** and **WhatsApp automation**. Outreach is **assisted** (the app drafts, a human sends). Last updated 2026-10-24.

Where things are: the app is this folder (Next.js, SQLite, API-key login); the earlier `probe/` command-line version was deleted on 2026-10-24. How to use the app: `README.md`. Deploying: `DEPLOY.md`. The long original plan, with the evaluation of the first ChatGPT plan, is `~/.claude/plans/i-want-to-build-snuggly-blossom.md`.

## Progress

| Phase | What | Status |
|---|---|---|
| 0 | Test that Apify can discover Egyptian seller pages (about $0.77 spent) | Done |
| 0b | Store every page in SQLite; filters (followers, country, city, type, WhatsApp); decide "has a website" from evidence | Done. The website agent has only run from the old `probe/` CLI (4 pages found no website, 9 have a listed site) |
| 1a | Dashboard: table, drawer, stage, notes, real-seller mark, CSV | Done |
| 1a+ | Hosted app: API-key login, background jobs with budgets, find-new-pages and check-websites actions | Built and tested locally. **Not deployed** |
| 1b | Enrich: read recent posts and ads into signals | Done. First paid run 2026-10-24 (9 pages, $0.41); it found and fixed two bugs (ledger under-count, ads not matched) |
| 1b | Scoring: shop score, WhatsApp score, pitch, reasons, Fit sort and filter | Built 2026-10-24. **Weights are guesses** |
| 2 | Assisted outreach: drafts, daily caps, sent log, do-not-contact list | **Blocked** until Egyptian counsel confirms the direct-marketing permit and consent rules (Law 151/2020). Not started |
| 3 | Learn from replies; cold email automation; Click-to-WhatsApp ads | Only if Phase 2 gets replies |

Data today: 30 pages, 9 enriched, 9 scored with a pitch.

## Next, in order

1. **Spot-check the scores.** Look at the top and bottom pages in the Fit sort on Facebook and note which look wrong; I adjust the weights in `src/lib/score.ts`. This is not labeling, only a quick look.
2. **Deploy** to the VPS following `DEPLOY.md`. The Docker, Caddy and firewall steps have never been run.
3. **Paid smoke tests in the app** (about $0.30): find 5 new pages, and run the website agent on 2 pages. Neither has run with real money inside the web app yet.
4. **Wider discovery**: several categories and cities (the first sample was one city, mostly household goods), then check websites and enrich the new pages.
5. **Store-platform detection** in the website check (Shopify, Salla, Zid, WooCommerce), so a brochure site and a real shop stop looking the same.
6. **Optional AI check** ("does this page sell physical goods to consumers?", about $0.002 a page). Only if non-sellers keep ranking high. One of the nine pages so far was a job-listings page.

## Rules we keep
- pnpm only. Secrets go in `.env`, never in `.env.example`.
- Every paid run has a budget. Each job has a cap and there is a daily cap. Check Apify's own run records after any paid run.
- "Has a website" is decided from evidence. A Cloudflare 403 means the site exists.
- No sending to anyone before the legal gate in Phase 2 is cleared. Assisted sending does not change the legal position.

## Known gaps
- A server restart mid-job aborts the Apify runs but does not record what they had charged.
- Scores rank fit, not willingness to pay.
- Single user, single shared key, one SQLite writer.
