import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// The console email sender appends every email here in development (Playwright runs from apps/web).
const OUTBOX = resolve(process.cwd(), '../../.dev-mail/outbox.jsonl');

type Mail = { to: string; subject: string; text: string };

/** Waits for the newest email to `to` whose subject contains `subject` and returns its first link. */
export async function waitForEmailLink(
  to: string,
  subject: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lines = (await readFile(OUTBOX, 'utf8').catch(() => '')).split('\n').filter(Boolean);
    const mails = lines.map((line) => JSON.parse(line) as Mail);
    const mail = mails.reverse().find((m) => m.to === to && m.subject.includes(subject));
    const link = mail?.text.match(/https?:\/\/\S+/)?.[0];
    if (link) return link;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subject}" email for ${to} in ${OUTBOX}`);
}

/** Every email to `to` with `subject` in its subject so far (oldest first). */
export async function emailsTo(to: string, subject: string): Promise<Mail[]> {
  const lines = (await readFile(OUTBOX, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return lines
    .map((line) => JSON.parse(line) as Mail)
    .filter((m) => m.to === to && m.subject.includes(subject));
}

/** Waits until there are at least `count` such emails, and returns them. */
export async function waitForEmails(to: string, subject: string, count = 1, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await emailsTo(to, subject);
    if (found.length >= count) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Expected ${count} "${subject}" email(s) for ${to}`);
}
