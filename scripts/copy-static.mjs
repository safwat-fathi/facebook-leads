// `output: 'standalone'` leaves out .next/static and public/: copy them next to server.js so `pnpm start` (and the Docker image) can serve them.
import { cpSync, existsSync } from 'node:fs';

if (existsSync('.next/standalone')) {
  cpSync('.next/static', '.next/standalone/.next/static', { recursive: true });
  if (existsSync('public')) cpSync('public', '.next/standalone/public', { recursive: true });
}
