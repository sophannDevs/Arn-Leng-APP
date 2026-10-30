import { z } from 'zod';
import { LOCALES } from '../constants';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../constants';

/** Input schemas for the auth forms and server actions. The same schemas run in the browser and on the server. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
export const nameSchema = z.string().trim().min(1).max(80);

export const signUpSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  // Not length-checked on sign-in: old passwords must still work if the policy changes.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({
  name: nameSchema,
  locale: z.enum(LOCALES),
});

export const becomeCreatorSchema = z.object({
  penName: z.string().trim().min(2).max(40),
  bio: z.string().trim().max(500).default(''),
});

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/);
export const backupCodeSchema = z.string().trim().min(6).max(32);
