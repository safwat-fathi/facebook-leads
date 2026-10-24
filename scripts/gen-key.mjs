// Prints a new API key ONCE plus the env lines the server needs. The server stores only the hash, so a lost key cannot be recovered: generate a new one.
import { createHash, randomBytes } from 'node:crypto';

const key = 'fbl_' + randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(key).digest('hex');
console.log(`
Your API key (shown once; put it in a password manager):

  ${key}

Add these to .env on the server (the key itself is NOT stored anywhere):

  APP_API_KEY_HASH=${hash}
  SESSION_SECRET=${randomBytes(48).toString('base64url')}

Changing SESSION_SECRET signs everyone out. Generating a new key and updating APP_API_KEY_HASH revokes the old key.
`);
