export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/** All outgoing email goes through this interface: Resend in production, the console in development. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
