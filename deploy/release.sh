#!/usr/bin/env bash
# Releases one commit on the VPS. It is the SSH forced command of the CI deploy key (authorized_keys):
#   restrict,command="/home/safwat/facebook-leads/deploy/release.sh" ssh-ed25519 AAAA... leads-deploy
# so the key can do nothing else. CI runs `ssh safwat@host <40-hex sha>`; by hand: `deploy/release.sh <sha>`.
# Same steps as DEPLOY.md "Updating". .env and data/ are never touched.
set -Eeuo pipefail

sha="${SSH_ORIGINAL_COMMAND:-${1:-}}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "release: need a full 40-char commit sha, got '${sha}'" >&2; exit 2; }

# A non-interactive ssh session has a minimal PATH, so pick up node/pnpm/pm2 the way a login shell would.
export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/share/pnpm:$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
for c in git node pnpm pm2 flock curl; do command -v "$c" > /dev/null || { echo "release: $c not on PATH" >&2; exit 3; }; done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a==22&&b>=19)?0:1)' \
  || { echo "release: node $(node -v) is too old, the app needs >= 22.19 (node:sqlite, undici 8)" >&2; exit 3; }

repo="$(cd "$(dirname "$0")/.." && pwd)"
exec 9> "${TMPDIR:-/tmp}/leads-release.lock"
flock -n 9 || { echo "release: another release is running" >&2; exit 4; }

# One brace group, parsed whole before it runs: the merge below can rewrite this very file, and bash reads scripts lazily.
{
  cd "$repo"
  git fetch --quiet origin main
  git merge --ff-only "$sha"          # never a reset: refuses a sha that isn't ahead of what is deployed
  pnpm install --frozen-lockfile
  pnpm build                          # ponytail: builds in place while the old process runs; a few seconds of errors possible, blue/green if it matters
  pm2 startOrRestart ecosystem.config.cjs --update-env && pm2 save

  # The app must answer on /login; wait for it so a broken build fails the deploy.
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null http://127.0.0.1:3100/login && { echo "release: $sha deployed"; exit 0; }
    sleep 2
  done
  echo "release: app is not responding on /login after 60s (pm2 logs leads)" >&2
  exit 5
}
