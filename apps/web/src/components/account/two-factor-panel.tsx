'use client';

import { totpCodeSchema } from '@inkline/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { Button, Field, FormMessage, linkClass } from '@/components/ui';
import { authErrorKey } from '@/lib/auth-errors';
import { authClient } from '@/lib/auth-client';

type Setup = { uri: string; secret: string; backupCodes: string[] };
type Prompt = 'enable' | 'disable' | 'codes' | null;

/** Turn two-factor authentication on or off and manage backup codes. Admins can't turn it off. */
export function TwoFactorPanel({
  enabled,
  required,
  hasPassword,
}: {
  enabled: boolean;
  required: boolean;
  hasPassword: boolean;
}) {
  const t = useTranslations('account.twoFactor');
  const tErrors = useTranslations('auth.errors');
  const router = useRouter();
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (hasPassword && !password) return setError(tErrors('wrongPassword'));
    const body = hasPassword ? { password } : ({} as { password: string });
    setPending(true);
    try {
      if (prompt === 'enable') {
        const { data, error: authError } = await authClient.twoFactor.enable(body);
        if (authError || data?.method !== 'totp') return setError(tErrors(authErrorKey(authError)));
        const secret = new URL(data.totpURI).searchParams.get('secret') ?? '';
        setSetup({ uri: data.totpURI, secret, backupCodes: data.backupCodes });
      } else if (prompt === 'disable') {
        const { error: authError } = await authClient.twoFactor.disable(body);
        if (authError) return setError(tErrors(authErrorKey(authError)));
        router.refresh();
      } else if (prompt === 'codes') {
        const { data, error: authError } = await authClient.twoFactor.generateBackupCodes(body);
        if (authError || !data) return setError(tErrors(authErrorKey(authError)));
        setCodes(data.backupCodes);
      }
      setPrompt(null);
    } finally {
      setPending(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const parsed = totpCodeSchema.safeParse(new FormData(event.currentTarget).get('code'));
    if (!parsed.success) return setError(tErrors('invalidCode'));
    setPending(true);
    const { error: authError } = await authClient.twoFactor.verifyTotp({ code: parsed.data });
    setPending(false);
    if (authError) return setError(tErrors(authErrorKey(authError)));
    setSetup(null);
    router.refresh();
  }

  const status = (
    <p className="m-0 text-sm font-semibold">
      {enabled ? t('statusOn') : t('statusOff')}
      {required && <span className="font-normal text-muted"> · {t('requiredForAdmins')}</span>}
    </p>
  );

  // Step 2 of setup: add the key to an authenticator app, save backup codes, confirm with a code.
  if (setup) {
    return (
      <form onSubmit={onVerify} className="flex flex-col gap-4" data-testid="two-factor-setup">
        <p className="m-0 text-sm">{t('setupLead')}</p>
        <div>
          <p className="m-0 text-xs font-semibold text-soft">{t('secretLabel')}</p>
          <code
            data-testid="two-factor-secret"
            className="mt-1 block break-all rounded-xl border-2 border-ink bg-paper px-3 py-2 text-sm font-bold tracking-wider"
          >
            {setup.secret}
          </code>
          <a href={setup.uri} className={`${linkClass} mt-2 inline-block text-sm`}>
            {t('openApp')}
          </a>
        </div>
        <BackupCodes codes={setup.backupCodes} />
        <Field
          id="code"
          label={t('codeLabel')}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <SubmitButton disabled={pending} className="self-start">
          {t('confirm')}
        </SubmitButton>
      </form>
    );
  }

  if (prompt) {
    return (
      <form onSubmit={onPassword} className="flex flex-col gap-4">
        {hasPassword ? (
          <Field
            id="password"
            type="password"
            label={t('passwordLabel')}
            autoComplete="current-password"
            required
          />
        ) : (
          <p className="m-0 text-sm">{t('noPassword')}</p>
        )}
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <div className="flex gap-3">
          <SubmitButton disabled={pending}>{t('continue')}</SubmitButton>
          <Button variant="ghost" onClick={() => setPrompt(null)}>
            {t('cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {status}
      {codes && <BackupCodes codes={codes} />}
      <div className="flex flex-wrap gap-3">
        {!enabled && <Button onClick={() => setPrompt('enable')}>{t('enable')}</Button>}
        {enabled && (
          <Button variant="ghost" onClick={() => setPrompt('codes')}>
            {t('newCodes')}
          </Button>
        )}
        {enabled && !required && (
          <Button variant="danger" onClick={() => setPrompt('disable')}>
            {t('disable')}
          </Button>
        )}
      </div>
    </div>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const t = useTranslations('account.twoFactor');
  return (
    <div>
      <p className="m-0 text-xs font-semibold text-soft">{t('backupCodes')}</p>
      <p className="mt-1 mb-2 text-[13px] text-muted">{t('backupCodesHint')}</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0" data-testid="backup-codes">
        {codes.map((code) => (
          <li
            key={code}
            className="rounded-lg border-2 border-ink bg-paper px-2 py-1 text-center font-mono text-sm font-bold"
          >
            {code}
          </li>
        ))}
      </ul>
    </div>
  );
}
