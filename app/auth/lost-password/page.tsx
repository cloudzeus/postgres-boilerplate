import Link from 'next/link';
import { FiArrowLeft } from 'react-icons/fi';
import { Input } from '@/components/ui/input';

export default function LostPasswordPage() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Επαναφορά κωδικού</h1>
        <p className="mt-1 text-sm text-muted-foreground">Θα σταλεί κωδικός OTP στο email σας.</p>
      </div>
      <form action="/api/auth/otp/send" method="post" className="flex flex-col gap-4">
        <input type="hidden" name="mode" value="reset" />
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">Email λογαριασμού</span>
          <Input type="email" name="email" required placeholder="name@dgsmart.gr" />
        </label>
        <button
          type="submit"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-brand-blue)] text-sm font-bold text-white shadow-cta transition-colors hover:bg-[var(--color-brand-blue-deep)]"
        >
          Αποστολή OTP
        </button>
      </form>
      <Link href="/auth/signin" className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-blue)] hover:text-[var(--color-brand-blue-deep)]">
        <FiArrowLeft className="size-3.5" /> Επιστροφή στη σύνδεση
      </Link>
    </div>
  );
}
