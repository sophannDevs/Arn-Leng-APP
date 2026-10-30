import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { EmailMessage, EmailSender } from './types';

/** Repo-root .dev-mail/outbox.jsonl (git-ignored); Next runs with apps/web as the working directory. */
export const DEV_OUTBOX_PATH = resolve(process.cwd(), '../../.dev-mail/outbox.jsonl');

/**
 * Development sender: prints each email to the server console and appends it to a local outbox
 * file, so the end-to-end tests can read verification links. Never use it in production.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.info(
      `\n[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}\n`,
    );
    await mkdir(dirname(DEV_OUTBOX_PATH), { recursive: true });
    await appendFile(
      DEV_OUTBOX_PATH,
      `${JSON.stringify({ ...message, sentAt: new Date().toISOString() })}\n`,
    );
  }
}
