import { collectTestObjectKeys, deleteTestUsers } from './helpers/db';
import { deleteTestObjects } from './helpers/storage';

// Remove what the tests created: their files in MinIO, then their users (sessions, accounts, 2FA,
// series, episodes and uploads go with them).
export default async function globalTeardown() {
  const keys = await collectTestObjectKeys();
  await deleteTestObjects('S3_BUCKET_PRIVATE', keys.private);
  await deleteTestObjects('S3_BUCKET_PUBLIC', keys.public);
  await deleteTestUsers();
}
