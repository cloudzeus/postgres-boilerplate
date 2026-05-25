import Link from 'next/link';
import { FiAlertCircle } from 'react-icons/fi';
import { Input } from '@/components/ui/input';

interface Props { searchParams: Promise<{ email?: string; mode?: string; error?: string }> }

export default async function VerifyOtpPage({ searchParams }: Props) {
  const sp = await searchParams;
  const email = sp.email ?? '';
  const mode = sp.mode === 'login' ? 'login' : sp.mode === 'register' ? 'register' : 'reset';
  const title = mode === 'register' ? 'Επαλήθευση εγγραφής' : mode === 'reset' ? 'Επαναφορά κωδικού' : 'Σύνδεση με OTP';
  const subtitle = mode === 'register'
    ? 'Εισάγετε τον OTP που λάβατε.'
    : mode === 'reset' ? 'Εισάγετε τον OTP και νέο κωδικό.' : 'Ο OTP εστάλη στο email σας.';
  const err = sp.error ? (sp.error === 'invalid' ? 'Λάθος ή ληγμένος κωδικός.' : `Σφάλμα: ${sp.error}`) : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <FiAlertCircle className="mt-0.5 size-3.5 shrink-0" /> {err}
        </div>
      )}
      <form action="/api/auth/otp/verify" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="mode" value={mode} />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">Email</span>
          <Input value={email} readOnly className="bg-muted text-muted-foreground" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">OTP κωδικός</span>
          <Input
            name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={8}
            placeholder="6-ψήφιος κωδικός"
            className="text-center tracking-[0.5em] font-mono"
          />
        </label>
        {mode === 'reset' && (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Νέος κωδικός</span>
            <Input type="password" name="password" autoComplete="new-password" required />
          </label>
        )}
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-blue)] text-sm font-bold text-white shadow-cta transition-colors hover:bg-[var(--color-brand-blue-deep)]"
        >
          Επιβεβαίωση
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/auth/signin" className="font-semibold text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-deep)]">
          Επιστροφή στη σύνδεση
        </Link>
      </p>
    </div>
  );
}
