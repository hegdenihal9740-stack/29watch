import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { AccountLayout } from '@/components/AccountLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useCustomer } from '@/components/CustomerAccounts';

export const Route = createFileRoute('/reset-password')({ head: () => ({ meta: [{ title: 'Reset password — BIG-B' }, { name: 'description', content: 'Set a new password for your BIG-B account.' }, { property: 'og:title', content: 'Reset password — BIG-B' }, { property: 'og:description', content: 'Securely recover your BIG-B account.' }, { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }] }), component: ResetPassword });
function ResetPassword() {
  const { user, ready } = useCustomer();
  const [recovery, setRecovery] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
        setMessage('');
      }
    });
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const query = url.searchParams;
    const recoveryRequested = hash.get('type') === 'recovery'
      || query.get('type') === 'recovery'
      || query.has('code');
    const callbackError = hash.get('error_description')
      ?? query.get('error_description')
      ?? hash.get('error')
      ?? query.get('error');
    if (callbackError) setMessage(callbackError);
    if (recoveryRequested) setRecovery(true);
    return () => subscription.unsubscribe();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!recovery || !user) { setMessage('Open a valid password reset link from your email.'); return; }
    if (password !== confirm) { setMessage('Passwords do not match.'); return; }
    setBusy(true);
    try { const { error } = await supabase.auth.updateUser({ password }); if (error) throw error; setDone(true); setMessage('Your password has been updated.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <AccountLayout title="Set a new password">{done ? <><p role="status">{message}</p><Button asChild className="mt-6"><Link to="/auth">My account</Link></Button></> : !recovery ? <><p>Open the reset link in your email to continue.</p>{message && <p role="alert">{message}</p>}<Button asChild variant="link"><Link to="/auth">Request a new link</Link></Button></> : <form className="space-y-5" onSubmit={submit}><label className="block space-y-2"><span>New password</span><Input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><label className="block space-y-2"><span>Confirm password</span><Input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>{message && <p role="alert">{message}</p>}{ready && !user && <p role="alert">This password reset link is invalid or expired. Request a new one.</p>}<Button type="submit" className="w-full" disabled={busy || !ready || !user}>{busy ? 'Updating…' : !ready ? 'Checking reset link…' : !user ? 'Reset link is invalid' : 'Update password'}</Button></form>}</AccountLayout>;
}