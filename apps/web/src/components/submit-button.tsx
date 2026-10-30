'use client';

import { type ComponentProps, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui';

const subscribe = () => () => {};

/** False while the server-rendered HTML is showing, true once React has taken over in the browser. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Submit button for forms that handle their own submit event. It stays disabled until the page has
 * hydrated: before that, pressing Enter or clicking would submit the form natively and put what the
 * user typed (including a password) into the URL.
 */
export function SubmitButton({ disabled, ...props }: Omit<ComponentProps<typeof Button>, 'type'>) {
  const hydrated = useHydrated();
  return <Button type="submit" disabled={disabled || !hydrated} {...props} />;
}
