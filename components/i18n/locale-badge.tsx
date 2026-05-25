import { cn } from '@/lib/utils';

interface Props {
  code: string;
  className?: string;
}

// Renders an ISO code as a compact uppercase badge — replacement for flag emoji.
export function LocaleBadge({ code, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-[26px] items-center justify-center rounded-sm bg-muted text-muted-foreground px-1 text-[9px] font-bold uppercase tracking-wider font-mono leading-none',
        className,
      )}
      aria-hidden
    >
      {code}
    </span>
  );
}
