// Brevo transactional email. The port is an interface so tests can fake it; the host is fixed, so nothing user-supplied picks the URL.
import 'server-only';

export interface MailPort {
  send(m: { to: string; subject: string; text: string }): Promise<{ messageId: string }>;
}

export function brevoMail(key: string, from: { email: string; name: string }): MailPort {
  return {
    async send({ to, subject, text }) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: from, replyTo: { email: from.email }, to: [{ email: to }], subject, textContent: text }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { messageId: String(((await res.json()) as { messageId?: string }).messageId ?? '') };
    },
  };
}
