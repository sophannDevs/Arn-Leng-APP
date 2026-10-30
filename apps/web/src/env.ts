import 'server-only';
import { parseWebEnv } from './env-schema';

/** Validated server environment. Importing this module fails fast if anything is missing. */
export const env = parseWebEnv(process.env);
