/* eslint-disable react/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '../../shared/api/client';
import type { AdminIdentity, AdminSessionResponse } from '../../../../../contracts/typescript/admin';

export type AdminUser = AdminIdentity;

interface SessionPayload extends AdminSessionResponse {
  recovery_codes?: string[];
}

interface AuthContextValue {
  admin: AdminUser | null;
  permissions: string[];
  loading: boolean;
  loginState: 'credentials' | 'mfa' | 'enroll' | 'recovery-codes';
  enrollment: { token: string; secret: string; uri: string } | null;
  recoveryCodes: string[];
  login(email: string, password: string): Promise<void>;
  verifyMfa(code: string): Promise<void>;
  enrollMfa(code: string): Promise<void>;
  recover(email: string, password: string, recoveryCode: string): Promise<void>;
  acknowledgeRecoveryCodes(): Promise<void>;
  cancelChallenge(): void;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  can(permission?: string): boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function applySession(payload: SessionPayload, setAdmin: (value: AdminUser | null) => void, setPermissions: (value: string[]) => void) {
  setCsrfToken(payload.csrf_token || '');
  setAdmin(payload.admin);
  setPermissions(payload.permissions || []);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loginState, setLoginState] = useState<AuthContextValue['loginState']>('credentials');
  const [challenge, setChallenge] = useState('');
  const [enrollment, setEnrollment] = useState<AuthContextValue['enrollment']>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const payload = await api<SessionPayload>('/api/admin/v1/auth/me');
    applySession(payload, setAdmin, setPermissions);
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      setAdmin(null);
      setPermissions([]);
      setCsrfToken('');
    }).finally(() => setLoading(false));
    const unauthorized = () => { setAdmin(null); setPermissions([]); setCsrfToken(''); };
    window.addEventListener('orderak:unauthorized', unauthorized);
    return () => window.removeEventListener('orderak:unauthorized', unauthorized);
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const payload = await api<Record<string, unknown>>('/api/admin/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (payload.mfa_required) {
      setChallenge(String(payload.mfa_token));
      setLoginState('mfa');
      return;
    }
    if (payload.mfa_enrollment_required) {
      setEnrollment({ token: String(payload.enrollment_token), secret: String(payload.secret), uri: String(payload.otpauth_uri) });
      setLoginState('enroll');
      return;
    }
    applySession(payload as unknown as SessionPayload, setAdmin, setPermissions);
  }, []);

  const verifyMfa = useCallback(async (code: string) => {
    const payload = await api<SessionPayload>('/api/admin/v1/auth/mfa', { method: 'POST', body: JSON.stringify({ mfa_token: challenge, code }) });
    applySession(payload, setAdmin, setPermissions);
    setChallenge('');
    setLoginState('credentials');
  }, [challenge]);

  const enrollMfa = useCallback(async (code: string) => {
    if (!enrollment) throw new Error('Enrollment expired');
    const payload = await api<SessionPayload>('/api/admin/v1/auth/enroll', { method: 'POST', body: JSON.stringify({ enrollment_token: enrollment.token, code }) });
    applySession(payload, setAdmin, setPermissions);
    setRecoveryCodes(payload.recovery_codes || []);
    setLoginState('recovery-codes');
  }, [enrollment]);

  const recover = useCallback(async (email: string, password: string, recoveryCode: string) => {
    const payload = await api<Record<string, unknown>>('/api/admin/v1/auth/recovery', { method: 'POST', body: JSON.stringify({ email, password, recovery_code: recoveryCode }) });
    setEnrollment({ token: String(payload.enrollment_token), secret: String(payload.secret), uri: String(payload.otpauth_uri) });
    setLoginState('enroll');
  }, []);

  const acknowledgeRecoveryCodes = useCallback(async () => {
    await api('/api/admin/v1/auth/recovery-codes/acknowledge', { method: 'POST', body: '{}' });
    setRecoveryCodes([]);
    setEnrollment(null);
    setLoginState('credentials');
  }, []);

  const cancelChallenge = useCallback(() => {
    setChallenge('');
    setEnrollment(null);
    setLoginState('credentials');
  }, []);

  const logout = useCallback(async () => {
    try { await api('/api/admin/v1/auth/logout', { method: 'POST' }); } finally {
      setAdmin(null); setPermissions([]); setCsrfToken(''); setLoginState('credentials');
    }
  }, []);

  // Membership only. The server sends the fully expanded permission set, so
  // every rule about what implies what — project:view granting the internal
  // read permissions, theme:rollback implying theme:manage and theme:view —
  // lives in permissionsForRole() and nowhere else.
  //
  // This used to re-derive those rules here and got them wrong: it understood
  // exact matches and `resource:*` and nothing else, so the UI hid sections the
  // API would happily have served, and neither implementation could notice the
  // other drifting.
  const can = useCallback((permission?: string) => {
    if (!permission) return true;
    return permissions.includes('*') || permissions.includes(permission);
  }, [permissions]);

  const value = useMemo(() => ({ admin, permissions, loading, loginState, enrollment, recoveryCodes, login, verifyMfa, enrollMfa, recover, acknowledgeRecoveryCodes, cancelChallenge, logout, refresh, can }), [admin, permissions, loading, loginState, enrollment, recoveryCodes, login, verifyMfa, enrollMfa, recover, acknowledgeRecoveryCodes, cancelChallenge, logout, refresh, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
