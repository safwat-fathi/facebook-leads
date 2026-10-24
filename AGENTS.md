<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project Rules & Constraints

### No Docker
- **Do NOT use Docker and do NOT suggest Docker.**
- The project does not use Docker and will not use Docker under any circumstances.
- Never create or reference `Dockerfile`, `docker-compose.yml`, `.dockerignore`, or container-based workflows.
- All development, testing, and production deployment run directly on the host using Node.js (>= 22.19) and `pnpm`.
- Production process management is handled natively on the host (pm2, as on the now-focus VPS, with a native nginx reverse proxy to `127.0.0.1:3100`; see `DEPLOY.md`).
