import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { BecomeCreatorForm } from '@/components/account/become-creator-form';
import { AuthShell } from '@/components/auth/auth-shell';
import { requireUser } from '@/server/auth/session';

export default async function BecomeCreatorPage() {
  const user = await requireUser();
  if (user.role !== 'reader') redirect(user.role === 'admin' ? '/admin' : '/studio');
  const t = await getTranslations('creator');
  return (
    <AuthShell title={t('title')} lead={t('lead')}>
      <BecomeCreatorForm />
    </AuthShell>
  );
}
