import { DEFAULT_LOCALE } from '@inkline/shared';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { EmailMessage } from './types';

// English only for now. When more locales arrive, pick the messages by the user's locale.
const t = createTranslator({ locale: DEFAULT_LOCALE, messages, namespace: 'email' });

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function layout(opts: { name: string; intro: string; action: string; url: string; outro: string }) {
  const name = escapeHtml(opts.name);
  const url = escapeHtml(opts.url);
  return `<div style="font-family:Poppins,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
<p>${t('greeting', { name })}</p>
<p>${escapeHtml(opts.intro)}</p>
<p><a href="${url}" style="display:inline-block;background:#d91e1e;color:#fff;font-weight:700;padding:12px 20px;border:2px solid #111;border-radius:12px;text-decoration:none">${escapeHtml(opts.action)}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(t('linkFallback'))}<br><a href="${url}">${url}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(opts.outro)}</p>
</div>`;
}

function plain(opts: { name: string; intro: string; url: string; outro: string }) {
  return `${t('greeting', { name: opts.name })}\n\n${opts.intro}\n\n${opts.url}\n\n${opts.outro}\n`;
}

export function verificationEmail(
  user: { name: string; email: string },
  url: string,
): EmailMessage {
  const intro = t('verify.intro');
  const outro = t('verify.outro');
  return {
    to: user.email,
    subject: t('verify.subject'),
    text: plain({ name: user.name, intro, url, outro }),
    html: layout({ name: user.name, intro, action: t('verify.action'), url, outro }),
  };
}

export function passwordResetEmail(
  user: { name: string; email: string },
  url: string,
): EmailMessage {
  const intro = t('reset.intro');
  const outro = t('reset.outro');
  return {
    to: user.email,
    subject: t('reset.subject'),
    text: plain({ name: user.name, intro, url, outro }),
    html: layout({ name: user.name, intro, action: t('reset.action'), url, outro }),
  };
}
