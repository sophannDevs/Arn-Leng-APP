import { describe, expect, it } from 'vitest';
import { type AuthzUser, authorize, canManageSeries, requiresTwoFactor } from './authz';

const reader: AuthzUser = { id: 'r', role: 'reader', twoFactorEnabled: false };
const creator: AuthzUser = { id: 'c', role: 'creator', twoFactorEnabled: false };
const admin: AuthzUser = { id: 'a', role: 'admin', twoFactorEnabled: true };
const adminNo2fa: AuthzUser = { ...admin, twoFactorEnabled: false };

describe('authorize', () => {
  it('rejects signed-out visitors as unauthenticated', () => {
    expect(authorize(null)).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(authorize(null, { roles: ['admin'] })).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('lets any signed-in user through when no role is required', () => {
    expect(authorize(reader)).toEqual({ ok: true, user: reader });
  });

  it('forbids a reader from creator and admin areas', () => {
    expect(authorize(reader, { roles: ['creator', 'admin'] })).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(authorize(reader, { roles: ['admin'] })).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('forbids a creator from the admin area but allows the creator area', () => {
    expect(authorize(creator, { roles: ['admin'] }).ok).toBe(false);
    expect(authorize(creator, { roles: ['creator', 'admin'] }).ok).toBe(true);
  });

  it('allows an admin with 2FA everywhere', () => {
    expect(authorize(admin, { roles: ['admin'] }).ok).toBe(true);
    expect(authorize(admin, { roles: ['creator', 'admin'] }).ok).toBe(true);
  });

  it('requires 2FA for admins, even for areas that need no role', () => {
    expect(authorize(adminNo2fa)).toEqual({ ok: false, reason: 'two_factor_required' });
    expect(authorize(adminNo2fa, { roles: ['admin'] })).toEqual({
      ok: false,
      reason: 'two_factor_required',
    });
  });

  it('lets an admin without 2FA reach the pages that set it up', () => {
    expect(authorize(adminNo2fa, { skipTwoFactor: true }).ok).toBe(true);
  });

  it('does not require 2FA for readers and creators', () => {
    expect(requiresTwoFactor('reader')).toBe(false);
    expect(requiresTwoFactor('creator')).toBe(false);
    expect(requiresTwoFactor('admin')).toBe(true);
    expect(authorize(creator, { roles: ['creator'] }).ok).toBe(true);
  });
});

describe('canManageSeries', () => {
  it('allows the owner and admins only', () => {
    expect(canManageSeries(creator, 'c')).toBe(true);
    expect(canManageSeries(creator, 'someone-else')).toBe(false);
    expect(canManageSeries(admin, 'someone-else')).toBe(true);
    expect(canManageSeries(reader, 'someone-else')).toBe(false);
  });
});
