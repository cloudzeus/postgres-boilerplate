import Link from 'next/link';
import { FiAlertCircle } from 'react-icons/fi';
import { Input } from '@/components/ui/input';

export default async function RegisterPage({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const err = sp.error
    ? sp.error === 'exists' ? 'Υπάρχει ήδη λογαριασμός με αυτό το email.' : `Σφάλμα: ${sp.error}`
    : null;
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Δημιουργία λογαριασμού</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ολοκλήρωσε την εγγραφή και επαλήθευσε με OTP.</p>
      </div>
      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <FiAlertCircle className="mt-0.5 size-3.5 shrink-0" /> {err}
        </div>
      )}
      <form action="/api/auth/register" method="post" className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">Ονοματεπώνυμο</span>
          <Input name="name" required placeholder="π.χ. Γιώργος Κοζύρης" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">Email</span>
          <Input type="email" name="email" autoComplete="email" required placeholder="name@dgsmart.gr" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">Κωδικός</span>
          <Input type="password" name="password" autoComplete="new-password" required placeholder="τουλάχιστον 8 χαρακτήρες" />
        </label>
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-blue)] text-sm font-bold text-white shadow-cta transition-colors hover:bg-[var(--color-brand-blue-deep)]"
        >
          Δημιουργία λογαριασμού
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Έχεις ήδη λογαριασμό;{' '}
        <Link href="/auth/signin" className="font-semibold text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-deep)]">Σύνδεση</Link>
      </p>
    </div>
  );
}
