import * as React from 'react';
import { HelpIcon } from '@/components/wiki/help-icon';

interface Props {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  helpAnchor?: string;
}

function cn(...c: (string | false | undefined)[]) { return c.filter(Boolean).join(' '); }

export function PageHeader({ title, description, icon, actions, className, helpAnchor }: Props) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-5', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {icon && (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-sm bg-[var(--cx-accent-soft)] text-primary shrink-0 [&_svg]:size-4">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-title-2 font-semibold tracking-tight text-foreground truncate">{title}</h1>
          {description && <p className="text-body-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {helpAnchor && <HelpIcon anchor={helpAnchor} />}
      </div>
    </div>
  );
}
