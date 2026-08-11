import { useState } from 'react';
import { Copy, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';

export function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState('owner@orderak.app');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (value) { setError(value instanceof Error ? value.message : 'Unable to continue'); }
    finally { setBusy(false); }
  }

  if (auth.loginState === 'recovery-codes') {
    return <AuthFrame icon={<ShieldCheck />} title="Save your recovery codes" subtitle="Each code works once. Store them in a password manager before continuing.">
      <div className="recovery-grid">{auth.recoveryCodes.map(item => <code key={item}>{item}</code>)}</div>
      <button className="button primary" onClick={() => { navigator.clipboard.writeText(auth.recoveryCodes.join('\n')); }}><Copy size={16} /> Copy codes</button>
      <button className="button" disabled={busy} onClick={() => submit(auth.acknowledgeRecoveryCodes)}>{busy ? 'Recording…' : 'I saved these codes'}</button>
      {error && <ErrorText>{error}</ErrorText>}
    </AuthFrame>;
  }

  if (auth.loginState === 'enroll' && auth.enrollment) {
    return <AuthFrame icon={<ShieldCheck />} title="Secure your admin account" subtitle="Add this secret to an authenticator app, then enter the current six-digit code.">
      <div className="secret-box"><span>Authenticator secret</span><code>{auth.enrollment.secret}</code></div>
      <form onSubmit={event => { event.preventDefault(); submit(() => auth.enrollMfa(code)); }}>
        <Field label="Authenticator code"><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
        <button disabled={busy || code.length !== 6} className="button primary full">{busy ? 'Verifying…' : 'Enable MFA'}</button>
      </form>
      <button className="link-button" onClick={auth.cancelChallenge}>Cancel</button>
      {error && <ErrorText>{error}</ErrorText>}
    </AuthFrame>;
  }

  if (auth.loginState === 'mfa') {
    return <AuthFrame icon={<KeyRound />} title="Two-factor authentication" subtitle="Enter the current code from your authenticator.">
      <form onSubmit={event => { event.preventDefault(); submit(() => auth.verifyMfa(code)); }}>
        <Field label="Six-digit code"><input autoFocus inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></Field>
        <button disabled={busy || code.length !== 6} className="button primary full">{busy ? 'Verifying…' : 'Verify and sign in'}</button>
      </form>
      <button className="link-button" onClick={auth.cancelChallenge}>Use another account</button>
      {error && <ErrorText>{error}</ErrorText>}
    </AuthFrame>;
  }

  return <AuthFrame icon={<LockKeyhole />} title="Orderak Control Center" subtitle="Sign in with your protected administrator account.">
    <form onSubmit={event => { event.preventDefault(); submit(() => recovering ? auth.recover(email, password, recovery) : auth.login(email, password)); }}>
      <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></Field>
      <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></Field>
      {recovering && <Field label="Single-use recovery code"><input autoComplete="one-time-code" value={recovery} onChange={event => setRecovery(event.target.value.toUpperCase())} /></Field>}
      <button disabled={busy || !email || !password} className="button primary full">{busy ? 'Checking…' : recovering ? 'Recover MFA' : 'Continue'}</button>
    </form>
    <button className="link-button" onClick={() => { setRecovering(value => !value); setError(''); }}>{recovering ? 'Back to sign in' : 'Use a recovery code'}</button>
    {error && <ErrorText>{error}</ErrorText>}
  </AuthFrame>;
}

function AuthFrame({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-mark">{icon}</div><p className="eyebrow">ORDERAK ADMIN</p><h1>{title}</h1><p className="muted">{subtitle}</p><div className="auth-content">{children}</div><p className="auth-footnote">Protected by password, mandatory MFA, short sessions and audited actions.</p></section></main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function ErrorText({ children }: { children: React.ReactNode }) { return <p className="error-text" role="alert">{children}</p>; }
