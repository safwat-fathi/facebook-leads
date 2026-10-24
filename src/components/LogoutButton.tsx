'use client';
import { postJson } from './api';

export function LogoutButton() {
  return (
    <button type="button" className="quiet" onClick={async () => { await postJson('/api/logout', {}); window.location.assign('/login'); }}>
      Sign out
    </button>
  );
}
