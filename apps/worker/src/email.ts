export type EmailMessage = { to: string; subject: string; text: string; html: string };

/** Outgoing email: Resend in production, the console in development. */
export type EmailSender = (message: EmailMessage) => Promise<void>;

export function createEmailSender(options: {
  apiKey: string | undefined;
  from: string;
}): EmailSender {
  const { apiKey, from } = options;
  if (!apiKey) {
    // Development: no real email. The address is left out of the log.
    return async (message) => console.info(`[worker] (dev) email not sent: "${message.subject}"`);
  }
  return async (message) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Status only: the response could echo the recipient, and the key must never be logged.
    if (!response.ok) throw new Error(`Resend rejected the email (HTTP ${response.status})`);
  };
}
