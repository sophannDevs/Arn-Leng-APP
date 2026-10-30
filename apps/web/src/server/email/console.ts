import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { EmailMessage, EmailSender } from './types';

/**
 * The repo root, found by its pnpm-workspace.yaml at run time. (Writing a fixed relative path here
 * made the Next.js bundler treat .dev-mail/ as part of the app, so every email written triggered a
 * hot reload that wiped the page the user was looking at.)
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Repo-root .dev-mail/outbox.jsonl (git-ignored); the end-to-end tests read the same file. */
export const devOutboxPath = () => join(repoRoot(), '.dev-mail', 'outbox.jsonl');

/**
 * Development sender: prints each email to the server console and appends it to a local outbox
 * file, so the end-to-end tests can read verification links. Never use it in production.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.info(
      `\n[email] To: ${message.to}\n[email] Subject: ${message.subject}\n${message.text}\n`,
    );
    const path = devOutboxPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify({ ...message, sentAt: new Date().toISOString() })}\n`);
  }
}
