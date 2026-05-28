import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { FiInfo, FiAlertTriangle, FiCheckCircle, FiAlertOctagon } from 'react-icons/fi';

export function Screenshot({
  src,
  caption,
  module,
  page,
}: {
  src: string;
  caption?: string;
  module?: string;
  page?: string;
}) {
  const url = src.startsWith('/') ? src : `/wiki/screenshots/${module}/${page}/${src}`;
  return (
    <figure className="my-6 overflow-hidden rounded-lg border border-border bg-card">
      <div className="relative aspect-video w-full">
        <Image src={url} alt={caption ?? ''} fill className="object-contain" sizes="(max-width: 1024px) 100vw, 800px" />
      </div>
      {caption && (
        <figcaption className="border-t border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

type CalloutType = 'info' | 'warning' | 'success' | 'danger';
const calloutStyles: Record<CalloutType, { bg: string; border: string; icon: React.ReactNode }> = {
  info: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-900', icon: <FiInfo className="text-blue-600" /> },
  warning: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900', icon: <FiAlertTriangle className="text-amber-600" /> },
  success: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900', icon: <FiCheckCircle className="text-emerald-600" /> },
  danger: { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-900', icon: <FiAlertOctagon className="text-red-600" /> },
};

export function Callout({ type = 'info', children }: { type?: CalloutType; children: React.ReactNode }) {
  const s = calloutStyles[type];
  return (
    <div className={`my-4 flex gap-3 rounded-md border px-3 py-2.5 text-[13px] ${s.bg} ${s.border}`}>
      <span className="mt-0.5 shrink-0 [&_svg]:size-4">{s.icon}</span>
      <div className="min-w-0 [&_p]:my-0 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </div>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="my-4 list-decimal space-y-2 pl-5 [&>li]:pl-1">{children}</ol>;
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      {role}
    </span>
  );
}

export const wikiMdxComponents = {
  Screenshot,
  Callout,
  Steps,
  RoleBadge,
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    const { href = '', ...rest } = props;
    if (href.startsWith('/')) return <Link href={href} {...rest} />;
    return <a href={href} target="_blank" rel="noopener noreferrer" {...rest} />;
  },
};
