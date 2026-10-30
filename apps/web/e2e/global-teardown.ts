import { deleteTestUsers } from './helpers/db';

// Remove the users the tests created (sessions, accounts and 2FA rows go with them).
export default async function globalTeardown() {
  await deleteTestUsers();
}
