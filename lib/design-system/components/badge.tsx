'use client';

import { cn } from '@/lib/utils';

export type BadgeVariant = 'neutral' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'info' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const badgeVariants: Record<BadgeVariant, string> = {
  neutral: 'bg-neutral-8 text-neutral-80 border border-neutral-20',
  blue: 'bg-sisyphus-50 text-sisyphus-700 border border-sisyphus-200',
  green: 'bg-success-50 text-success-500 border border-green-200',
  orange: 'bg-warning-50 text-warning-500 border border-orange-200',
  red: 'bg-danger-50 text-danger-500 border border-red-200',
  purple: 'bg-purple-50 text-accent-purple border border-purple-200',
  info: 'bg-sisyphus-50 text-sisyphus-700 border border-sisyphus-200',
  success: 'bg-success-50 text-success-500 border border-green-200',
  warning: 'bg-warning-50 text-warning-500 border border-orange-200',
  danger: 'bg-danger-50 text-danger-500 border border-red-200',
};

/**
 * DG Badge — Small, semantic label
 * Use for statuses, priorities, categories
 */
export function Badge({ 
  children, 
  variant = 'neutral', 
  className 
}: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-1 rounded-sm text-xs font-semibold border',
      badgeVariants[variant],
      className,
    )}>
      {children}
    </span>
  );
}

/**
 * DG Tag — Hashtag-style label for tags/keywords
 */
export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[11px] font-semibold bg-neutral-6 text-neutral-70 border border-neutral-10">
      #{children}
    </span>
  );
}

/**
 * DG Status Badge — Semantic status indicator
 */
interface StatusBadgeProps {
  status: 'active' | 'inactive' | 'pending' | 'completed' | 'failed' | 'draft';
  children?: React.ReactNode;
  showDot?: boolean;
}

export function StatusBadge({ status, children, showDot = true }: StatusBadgeProps) {
  const statusConfig = {
    active: { variant: 'success' as const, label: 'Active' },
    inactive: { variant: 'neutral' as const, label: 'Inactive' },
    pending: { variant: 'warning' as const, label: 'Pending' },
    completed: { variant: 'success' as const, label: 'Completed' },
    failed: { variant: 'danger' as const, label: 'Failed' },
    draft: { variant: 'neutral' as const, label: 'Draft' },
  };

  const config = statusConfig[status];

  return (
    <Badge variant={config.variant} className="gap-1.5">
      {showDot && (
        <span className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'active' && 'bg-success-500',
          status === 'inactive' && 'bg-neutral-40',
          status === 'pending' && 'bg-warning-500',
          status === 'completed' && 'bg-success-500',
          status === 'failed' && 'bg-danger-500',
          status === 'draft' && 'bg-neutral-40',
        )} />
      )}
      {children || config.label}
    </Badge>
  );
}
