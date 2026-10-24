// Constants shared by proxy.ts and the server code. No secrets and no Node-only imports here.
export const SESSION_TTL_S = 7 * 24 * 3600;
// `__Host-` needs Secure + Path=/ + no Domain, so it only works over https (production). Local http dev uses a plain name.
export const sessionCookieName = () => (process.env.NODE_ENV === 'production' ? '__Host-fbl_session' : 'fbl_session');
