// components/templates/run-status-pill.tsx — the one place a TemplateRun status turns into colour.
// Deliberately free of hooks and handlers so both the server-rendered lists (OCR list, folder page)
// and the client run card can render it. Data colours are inline hex on purpose: Tailwind's JIT
// cannot see class names built at runtime.
import type { RunStatus } from '@/lib/templates/schema';
import { RUN_STATUS_LABEL } from '@/lib/templates/labels';

export const RUN_STATUS_STYLE: Record<RunStatus, { bg: string; fg: string }> = {
  EXTRACTED: { bg: '#EAF4FC', fg: '#0078D4' },
  REVIEW: { bg: '#FDF3E3', fg: '#B45309' },
  BLOCKED: { bg: '#FDE8E8', fg: '#B91C1C' },
  POSTED: { bg: '#E8F7F0', fg: '#047857' },
  FAILED: { bg: '#F3F2F1', fg: '#5C5C5C' },
};

export function RunStatusPill({ status, className }: { status: RunStatus; className?: string }) {
  const s = RUN_STATUS_STYLE[status] ?? RUN_STATUS_STYLE.FAILED;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[length:var(--fs-11)] font-medium whitespace-nowrap ${className ?? ''}`}
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {RUN_STATUS_LABEL[status] ?? status}
    </span>
  );
}
