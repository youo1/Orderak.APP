import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '@/shared/api/client';
import { useAuth } from '@/features/auth/auth-context';

export function AccountSecurityGate() {
  const auth = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (newPassword.length < 12) return setError('Use at least 12 characters.');
    if (newPassword !== confirmPassword) return setError('New passwords do not match.');
    setBusy(true);
    try {
      await api('/api/admin/v1/auth/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, totp_code: totp }) });
      await auth.refresh();
    } catch (value) { setError(value instanceof Error ? value.message : 'Unable to change password'); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-card wide"><div className="auth-mark"><KeyRound /></div><p className="eyebrow">FIRST SIGN-IN</p><h1>Replace the one-time password</h1><p className="muted">Full control remains locked until you verify the current password and TOTP, then choose a new password.</p><form onSubmit={submit} className="auth-content"><label className="field"><span>One-time password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label><label className="field"><span>Authenticator code</span><input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={event => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label><button className="button primary full" disabled={busy || totp.length !== 6}>Change password and unlock</button>{error && <p className="error-text" role="alert">{error}</p>}</form></section></main>;
}
