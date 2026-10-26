import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <main className="login">
      <div className="login-card">
        <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="currentColor" /><path d="M9 21V11m7 10V8m7 13v-6" stroke="#fff" strokeWidth="3" strokeLinecap="round" fill="none" /></svg>
        <h1>Seller leads</h1>
        <p className="lede">Paste your API key to continue.</p>
        <LoginForm />
      </div>
    </main>
  );
}
