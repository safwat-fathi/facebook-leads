# Roadmap and progress

Goal: find Egyptian Facebook pages that sell online, see which have no real shop or WhatsApp automation, and (later) contact them.
Services pitched: **web shop** and **WhatsApp automation**. Outreach is **assisted** (the app drafts, a human sends). Last updated 2026-10-25.

Where things are: the app is this folder (Next.js, SQLite, API-key login); the earlier `probe/` command-line version was deleted on 2026-10-24. How to use the app: `README.md`. Deploying: `DEPLOY.md`. The long original plan, with the evaluation of the first ChatGPT plan, is `~/.claude/plans/i-want-to-build-snuggly-blossom.md`.

## Progress

| Phase | What | Status |
|---|---|---|
| 0 | Test that Apify can discover Egyptian seller pages (about $0.77 spent) | Done |
| 0b | Store every page in SQLite; filters (followers, country, city, type, WhatsApp); decide "has a website" from evidence | Done. The website agent has only run from the old `probe/` CLI (4 pages found no website, 9 have a listed site) |
| 1a | Dashboard: table, drawer, stage, notes, real-seller mark, CSV | Done |
| 1a+ | Hosted app: API-key login, background jobs with budgets, find-new-pages and check-websites actions | Done and deployed (login, background jobs with budgets, find-new-pages and check-websites; paid smoke tests run in the app) |
| 1b | Enrich: read recent posts and ads into signals | Done. First paid run 2026-10-24 (9 pages, $0.41); it found and fixed two bugs (ledger under-count, ads not matched) |
| 1b | Scoring: shop score, WhatsApp score, pitch, reasons, Fit sort and filter | Built 2026-10-24. **Weights are guesses** |
| 2 | Assisted outreach: drafts, daily caps, sent log, do-not-contact list | Built 2026-10-25: LLM drafts, Brevo email from hello@tijaratk.com, WhatsApp link, do-not-contact, daily cap, sent log. **Legal gate not cleared by counsel**; sending is the owner's decision (Law 151/2020). Not yet used for real sends |
| 1c | Store-platform detection (Shopify, Salla, Zid, WooCommerce) in the website check, filter and score | Built 2026-10-25. Existing pages need a re-check to get it |
| 3 | Learn from replies; cold email automation; Click-to-WhatsApp ads | Only if Phase 2 gets replies |

Data today: 30 pages, 9 enriched, 9 scored with a pitch.

## Next, in order

1. **Spot-check the scores.** Look at the top and bottom pages in the Fit sort on Facebook and note which look wrong; I adjust the weights in `src/lib/score.ts`. This is not labeling, only a quick look.
2. **Re-check websites** (with recheck on) so existing pages get a store platform.
3. **First real outreach**: add `BREVO_API_KEY` to the server `.env`, confirm `hello@tijaratk.com` is a verified Brevo sender, and send one email to an address you control.
4. **Wider discovery**: several categories and cities (the first sample was one city, mostly household goods), then check websites and enrich the new pages.
5. **Optional AI check** ("does this page sell physical goods to consumers?", about $0.002 a page). Only if non-sellers keep ranking high. One of the nine pages so far was a job-listings page.

## Rules we keep
- No Docker. Runs directly on the host using Node.js, pnpm, pm2, and native nginx.
- pnpm only. Secrets go in `.env`, never in `.env.example`.
- Every paid run has a budget. Each job has a cap and there is a daily cap. Check Apify's own run records after any paid run.
- "Has a website" is decided from evidence. A Cloudflare 403 means the site exists.
- Every send is a human click, capped per day, skips the do-not-contact list and carries an opt-out line. None of that settles the legal position (Law 151/2020); that is the owner's call.

## Known gaps
- A server restart mid-job aborts the Apify runs but does not record what they had charged.
- Scores rank fit, not willingness to pay.
- Single user, single shared key, one SQLite writer.
