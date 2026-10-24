import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <main className="login">
      <h1>Egyptian seller leads</h1>
      <p className="summary">Paste your API key to continue.</p>
      <LoginForm />
    </main>
  );
}
