'use client';
import { postJson } from './api';

export function LogoutButton() {
  return (
    <button type="button" className="navlink signout" aria-label="Sign out" onClick={async () => { await postJson('/api/logout', {}); window.location.assign('/login'); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" /></svg>
      <span>Sign out</span>
    </button>
  );
}
