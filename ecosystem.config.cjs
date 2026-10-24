// pm2 app for the VPS: `pm2 startOrRestart ecosystem.config.cjs --update-env && pm2 save` (deploy/release.sh does this).
// 3100, not 3000: the now-focus API already uses 3000 on the same box. nginx proxies to it; the port is never opened in the firewall.
// standalone server.js chdir()s into .next/standalone, so DATA_DIR must be absolute. Node loads .env; values set here win over it.
const path = require('node:path');

module.exports = {
  apps: [{
    name: 'leads',
    cwd: __dirname,
    script: '.next/standalone/server.js',
    node_args: '--no-warnings --env-file=.env',
    env: {
      NODE_ENV: 'production',
      PORT: '3100',
      HOSTNAME: '127.0.0.1',
      DATA_DIR: path.join(__dirname, 'data'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
  }],
};
