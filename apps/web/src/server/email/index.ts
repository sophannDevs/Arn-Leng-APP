import 'server-only';
import { env } from '@/env';
import { ConsoleEmailSender } from './console';
import { ResendEmailSender } from './resend';
import type { EmailSender } from './types';

export type { EmailMessage, EmailSender } from './types';

let sender: EmailSender | undefined;

/** Resend when RESEND_API_KEY is set; otherwise the console sender (rejected in production by the env schema). */
export function getEmailSender(): EmailSender {
  sender ??= env.RESEND_API_KEY
    ? new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : new ConsoleEmailSender();
  return sender;
}
