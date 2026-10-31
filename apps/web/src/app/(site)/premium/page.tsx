import { permanentRedirect } from 'next/navigation';

/** The old address of the plans page. */
export default function PremiumPage() {
  return permanentRedirect('/subscribe');
}
