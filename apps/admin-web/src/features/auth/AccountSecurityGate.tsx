import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '@/shared/api/client';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';

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
  return <main className="auth-page"><section className="auth-card wide"><div className="auth-mark"><KeyRound /></div><p className="eyebrow">FIRST SIGN-IN</p><h1>Replace the one-time password</h1><p className="muted">Full control remains locked until you verify the current password and TOTP, then choose a new password.</p><form onSubmit={submit} className="auth-content"><Field label="One-time password"><Input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></Field><Field label="New password"><Input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></Field><Field label="Confirm new password"><Input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></Field><Field label="Authenticator code"><Input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={event => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field><Button className="w-full" disabled={busy || totp.length !== 6}>Change password and unlock</Button>{error && <p className="error-text" role="alert">{error}</p>}</form></section></main>;
}
