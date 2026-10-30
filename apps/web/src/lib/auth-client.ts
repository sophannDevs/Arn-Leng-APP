import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { auth } from '@/server/auth/auth';

// Type-only import: the server config never reaches the browser bundle.
export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof auth>(), twoFactorClient()],
});
