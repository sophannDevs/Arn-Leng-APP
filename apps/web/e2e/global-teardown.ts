import { collectTestObjects, deleteTestUsers } from './helpers/db';
import { deleteTestObjects, deleteTestPrefixes } from './helpers/storage';

// Remove what the tests created: their files in MinIO (uploads, processed images, originals,
// resized covers), then their users (sessions, accounts, 2FA, series, episodes and uploads go with them).
export default async function globalTeardown() {
  const found = await collectTestObjects();
  await deleteTestObjects('S3_BUCKET_PRIVATE', found.privateKeys);
  await deleteTestPrefixes('S3_BUCKET_PRIVATE', found.privatePrefixes);
  await deleteTestObjects('S3_BUCKET_PUBLIC', found.publicKeys);
  await deleteTestPrefixes('S3_BUCKET_PUBLIC', found.publicPrefixes);
  await deleteTestUsers();
}
