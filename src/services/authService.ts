import {db} from '../db/database';
import type {AuditUser, CountSession} from '../types';
import {queueFirestoreSync} from './firebaseSync';

const AUTH_KEY = 'audit-current-user';
export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = '1234';

export type AuthUser = Omit<AuditUser, 'password'>;

function withoutPassword(user: AuditUser): AuthUser {
  const {password: _password, ...safeUser} = user;
  return safeUser;
}

function normalize(value: unknown) {
  return String(value ?? '').trim();
}

function sameBranch(a: string, b: string) {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

export async function ensureDefaultAdmin() {
  const count = await db.auditUsers.count();
  if (count) return;

  const now = new Date();
  await db.auditUsers.add({
    username: DEFAULT_ADMIN_USERNAME,
    password: DEFAULT_ADMIN_PASSWORD,
    displayName: 'ผู้ดูแลระบบ',
    role: 'ADMIN',
    allowedBranches: ['*'],
    isActive: true,
    createdAt: now,
    updatedAt: now
  });
  queueFirestoreSync(['auditUsers']);
}

export function getCurrentUser(): AuthUser | undefined {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) as AuthUser : undefined;
  } catch {
    return undefined;
  }
}

export function setCurrentUser(user: AuditUser) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(withoutPassword(user)));
  window.dispatchEvent(new Event('audit-auth-changed'));
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem('audit-selected-session');
  window.dispatchEvent(new Event('audit-auth-changed'));
}

export async function login(username: string, password: string) {
  await ensureDefaultAdmin();
  const user = await db.auditUsers.where('username').equals(normalize(username)).first();
  if (!user || !user.isActive || user.password !== password) {
    throw new Error('User หรือ Password ไม่ถูกต้อง');
  }
  setCurrentUser(user);
  return withoutPassword(user);
}

export async function verifyHistoryDeleteCredentials(username: string, password: string, branchName: string) {
  await ensureDefaultAdmin();
  const user = await db.auditUsers.where('username').equals(normalize(username)).first();
  if (!user || !user.isActive || user.password !== password) {
    throw new Error('Username หรือ Password ไม่ถูกต้อง');
  }
  const ownsBranch = user.allowedBranches.some(branch => branch === '*' || sameBranch(branch, branchName));
  if (user.role !== 'ADMIN' && !ownsBranch) {
    throw new Error(`บัญชีนี้ไม่มีสิทธิ์ลบประวัติของสาขา ${branchName}`);
  }
  return withoutPassword(user);
}

export function canAccessBranch(user: AuthUser | undefined, branchName: string) {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  return user.allowedBranches.some(branch => branch === '*' || sameBranch(branch, branchName));
}

export function filterSessionsByUser<T extends Pick<CountSession, 'branchName'>>(sessions: T[], user: AuthUser | undefined) {
  return sessions.filter(session => canAccessBranch(user, session.branchName));
}

export function branchListText(user: AuthUser | undefined) {
  if (!user) return '';
  if (user.role === 'ADMIN' || user.allowedBranches.includes('*')) return 'ทุกสาขา';
  return user.allowedBranches.join(', ');
}
