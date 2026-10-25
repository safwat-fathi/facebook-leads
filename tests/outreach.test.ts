import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/lib/env';
import { openDb, useDbForTests, getDb } from '@/lib/db';
import { recordToRow } from '@/lib/ingest';
import { draftMessage, outreachState, sendEmail, setDoNotContact, whatsappLink, type OutreachDeps } from '@/lib/outreach';
import { savePage, upsertPage } from '@/lib/pages';
import type { MailPort } from '@/lib/brevo';
import type { LlmPort } from '@/lib/llm';
import { RECORDS } from './fixtures/records';

const stage = (id: string) => (getDb().prepare('select stage from pages where fb_page_id = ?').get(id) as { stage: string }).stage;
const mail = () => { const sent: { to: string; subject: string; text: string }[] = []; const port: MailPort = { send: vi.fn(async (m) => { sent.push(m); return { messageId: `<m${sent.length}>` }; }) }; return { port, sent }; };
const deps = (over: Partial<OutreachDeps> = {}): OutreachDeps => ({ mail: mail().port, dailyCap: 20, ...over });
const llm = (content: string, costUsd = 0.002): LlmPort => ({ chat: vi.fn(async () => ({ message: { role: 'assistant' as const, content }, costUsd })) });

let id: string;
beforeEach(() => {
  vi.stubEnv('APP_API_KEY_HASH', 'a'.repeat(64)); vi.stubEnv('SESSION_SECRET', 'x'.repeat(40)); vi.stubEnv('APP_ORIGIN', 'https://leads.example.com');
  vi.stubEnv('DAILY_BUDGET_USD', '10'); vi.stubEnv('MAX_JOB_USD', '3');
  resetEnvForTests();
  useDbForTests(openDb(':memory:'));
  RECORDS.forEach((r) => upsertPage(recordToRow(r, 'seed')!));
  id = (getDb().prepare("select fb_page_id from pages where email is not null and country = 'Egypt' limit 1").get() as { fb_page_id: string }).fb_page_id;
});

describe('sendEmail', () => {
  const msg = { subject: 'مرحبا', body: 'رسالة تجريبية' };
  it('sends once, appends the opt-out line, logs it and moves the lead to contacted', async () => {
    const m = mail();
    await sendEmail(id, msg, deps({ mail: m.port }));
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0].text).toContain('reply "stop"');
    expect(stage(id)).toBe('contacted');
    expect(outreachState(id).log).toMatchObject([{ channel: 'email', status: 'sent' }]);
  });
  it('tags the channel used, keeping channels the person ticked by hand', async () => {
    savePage(id, { stage: 'contacted', contacted_via: ['other', 'facebook'] });
    await sendEmail(id, msg, deps());
    expect((getDb().prepare('select contacted_via v from pages where fb_page_id = ?').get(id) as { v: string }).v).toBe('facebook,email,other');
  });
  it('saves contacted_via in a fixed order, clears it with an empty list and rejects unknown channels', () => {
    const via = () => (getDb().prepare('select contacted_via v from pages where fb_page_id = ?').get(id) as { v: string | null }).v;
    savePage(id, { contacted_via: ['email', 'facebook', 'email'] }); expect(via()).toBe('facebook,email');
    savePage(id, { contacted_via: [] }); expect(via()).toBeNull();
    expect(() => savePage(id, { contacted_via: ['carrier pigeon'] })).toThrow();
  });
  it('refuses a second email to the same address', async () => {
    const d = deps(); await sendEmail(id, msg, d);
    await expect(sendEmail(id, msg, d)).rejects.toThrow(/Already emailed/);
  });
  it('refuses a page on the do-not-contact list, and allows it again once removed', async () => {
    setDoNotContact(id, true);
    expect(outreachState(id).dnc).toBe(true);
    await expect(sendEmail(id, msg, deps())).rejects.toThrow(/do-not-contact/);
    setDoNotContact(id, false);
    await expect(sendEmail(id, msg, deps())).resolves.toEqual({ status: 'sent' });
  });
  it('stops at the daily cap', async () => {
    await expect(sendEmail(id, msg, deps({ dailyCap: 0 }))).rejects.toThrow(/Daily cap/);
  });
  it('is off without a Brevo key', async () => {
    await expect(sendEmail(id, msg, { dailyCap: 20 })).rejects.toThrow(/BREVO_API_KEY/);
  });
  it('a provider failure is logged as failed, does not change the stage and can be retried', async () => {
    const failing: MailPort = { send: async () => { throw new Error('Brevo 401: nope'); } };
    await expect(sendEmail(id, msg, deps({ mail: failing }))).rejects.toThrow(/not sent/);
    expect(stage(id)).toBe('new');
    expect(outreachState(id).log[0]).toMatchObject({ status: 'failed' });
    await expect(sendEmail(id, msg, deps())).resolves.toEqual({ status: 'sent' });
  });
  it('rejects empty or unknown fields', async () => {
    await expect(sendEmail(id, { subject: '', body: 'x' }, deps())).rejects.toThrow();
    await expect(sendEmail(id, { ...msg, to: 'someone@else.com' }, deps())).rejects.toThrow();
  });
  it('a page marked not a seller is never contacted', async () => {
    getDb().prepare("update pages set verdict = 'seller_no' where fb_page_id = ?").run(id);
    await expect(sendEmail(id, msg, deps())).rejects.toThrow(/not a real seller/);
  });
  it('does not downgrade a lead that already replied', async () => {
    getDb().prepare("update pages set stage = 'replied' where fb_page_id = ?").run(id);
    await sendEmail(id, msg, deps());
    expect(stage(id)).toBe('replied');
  });
});

describe('whatsappLink', () => {
  it('builds a wa.me link with the message and logs it, without sending anything', () => {
    getDb().prepare("update pages set whatsapp = '+201001234567' where fb_page_id = ?").run(id);
    const { url } = whatsappLink(id, { body: 'مرحبا' });
    expect(url).toBe(`https://wa.me/201001234567?text=${encodeURIComponent('مرحبا')}`);
    expect(outreachState(id).log[0]).toMatchObject({ channel: 'whatsapp', status: 'opened' });
  });
  it('needs a number and respects do-not-contact', () => {
    getDb().prepare('update pages set whatsapp = null where fb_page_id = ?').run(id);
    expect(() => whatsappLink(id, { body: 'x' })).toThrow(/no WhatsApp/);
    getDb().prepare("update pages set whatsapp = '+201001234567' where fb_page_id = ?").run(id);
    setDoNotContact(id, true);
    expect(() => whatsappLink(id, { body: 'x' })).toThrow(/do-not-contact/);
  });
});

describe('draftMessage', () => {
  it('splits subject and body and records the cost in the ledger', async () => {
    const out = await draftMessage(id, deps({ llm: llm('الموضوع: متجر خاص بكم\n\nأهلاً، عندنا فكرة لمتجركم.') }));
    expect(out).toEqual({ subject: 'متجر خاص بكم', body: 'أهلاً، عندنا فكرة لمتجركم.' });
    expect((getDb().prepare("select sum(usd) s from spend where provider = 'openrouter'").get() as { s: number }).s).toBeCloseTo(0.002);
  });
  it('saves the draft on the page, and sending clears it', async () => {
    await draftMessage(id, deps({ llm: llm('موضوع\n\nنص الرسالة') }));
    expect(getDb().prepare('select draft_subject s, draft_body b from pages where fb_page_id = ?').get(id)).toMatchObject({ s: 'موضوع', b: 'نص الرسالة' });
    await sendEmail(id, { subject: 'موضوع', body: 'نص الرسالة' }, deps());
    expect(getDb().prepare('select draft_subject s, draft_body b from pages where fb_page_id = ?').get(id)).toMatchObject({ s: null, b: null });
  });
  it('tells the model when you confirmed the website by hand', async () => {
    savePage(id, { website: { url: 'https://shop.example.com', platform: 'zid' } });
    const port = llm('s\n\nb');
    await draftMessage(id, deps({ llm: port }));
    const sent = JSON.parse(vi.mocked(port.chat).mock.calls[0][0][1].content as string);
    expect(sent.page).toMatchObject({ website: 'shop.example.com', store_platform: 'zid', website_confirmed_by_sender: true });
  });
  it('gives the model the website, store platform and your notes', async () => {
    getDb().prepare("update pages set website_domain = 'shop.example.com', store_platform = 'salla', notes = 'met at the fair' where fb_page_id = ?").run(id);
    const port = llm('s\n\nb');
    await draftMessage(id, deps({ llm: port }));
    const sent = JSON.parse((vi.mocked(port.chat).mock.calls[0][0][1].content as string));
    expect(sent.page).toMatchObject({ website: 'shop.example.com', store_platform: 'salla', my_notes: 'met at the fair' });
  });
  it('refuses an unusable model answer and works only when a model is configured', async () => {
    await expect(draftMessage(id, deps({ llm: llm('just one line') }))).rejects.toThrow(/usable draft/);
    await expect(draftMessage(id, deps())).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
