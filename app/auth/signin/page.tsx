import Link from 'next/link';
import { FiAlertCircle } from 'react-icons/fi';
import { FaMicrosoft } from 'react-icons/fa';
import { Input } from '@/components/ui/input';

export default async function SignInPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; mode?: string }> }) {
  const sp = await searchParams;
  const otpMode = sp.mode === 'otp';
  const err = sp.error
    ? sp.error === 'invalid'
      ? 'Λάθος email ή κωδικός.'
      : `Σφάλμα: ${sp.error}`
    : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Σύνδεση</h1>
        <p className="mt-1 text-sm text-muted-foreground">Καλώς ήρθες πίσω. Email + κωδικός ή OTP.</p>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <FiAlertCircle className="mt-0.5 size-3.5 shrink-0" /> {err}
        </div>
      )}

      {!otpMode ? (
        <form action="/api/auth/password" method="post" className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Email</span>
            <Input type="email" name="email" autoComplete="email" required placeholder="name@dgsmart.gr" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-xs font-semibold text-foreground">
              Κωδικός
              <Link href="/auth/lost-password" className="text-[11px] font-medium text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-deep)]">
                Ξεχάσατε τον κωδικό;
              </Link>
            </span>
            <Input type="password" name="password" autoComplete="current-password" required placeholder="••••••••" />
          </label>
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-blue)] text-sm font-bold text-white shadow-cta transition-colors hover:bg-[var(--color-brand-blue-deep)]"
          >
            Σύνδεση
          </button>
        </form>
      ) : (
        <form action="/api/auth/otp/send" method="post" className="flex flex-col gap-4">
          <input type="hidden" name="mode" value="login" />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-foreground">Email για OTP</span>
            <Input type="email" name="email" required placeholder="name@dgsmart.gr" />
          </label>
          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-blue)] text-sm font-bold text-white shadow-cta transition-colors hover:bg-[var(--color-brand-blue-deep)]"
          >
            Αποστολή κωδικού OTP
          </button>
        </form>
      )}

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />ή<span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href={otpMode ? '/auth/signin' : '/auth/signin?mode=otp'}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {otpMode ? 'Σύνδεση με κωδικό' : 'Σύνδεση με OTP'}
        </Link>
        <Link
          href="/api/auth/signin/microsoft-entra-id"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <FaMicrosoft className="text-[var(--color-brand-blue)]" /> Σύνδεση με Microsoft
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Δεν έχετε λογαριασμό;{' '}
        <Link href="/auth/register" className="font-semibold text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-deep)]">
          Δημιουργία λογαριασμού
        </Link>
      </p>
    </div>
  );
}
