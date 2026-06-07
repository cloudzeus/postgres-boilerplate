'use client';
import * as React from 'react';
import { useMarquee, type NormBox } from '@/app/admin/ocr/[id]/use-marquee';

export type SavedRegion = { bbox: [number, number, number, number]; color?: string; active?: boolean };

type Props = {
  pageImageUrl: (page: number) => string;
  pageCount?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  savedRegions?: SavedRegion[];
  isMarking: boolean;
  onRegionComplete: (box: NormBox, page: number) => void;
  onError?: () => void;
  className?: string;
};

export function RegionMarker({
  pageImageUrl, pageCount = 1, page = 0, onPageChange, savedRegions = [], isMarking, onRegionComplete, onError, className,
}: Props) {
  const url = pageImageUrl(page);
  const [objUrl, setObjUrl] = React.useState<string | null>(null);
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Fetch the page image ourselves (instead of <img src>) so that on a non-OK
  // response we can read the JSON error body and show the real reason.
  React.useEffect(() => {
    let alive = true;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrMsg(null);
    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          if (!alive) return;
          setErrMsg(`HTTP ${res.status} — ${body.slice(0, 400)}`);
          setObjUrl(null);
          setLoading(false);
          onError?.();
          return;
        }
        const blob = await res.blob();
        if (!alive) return;
        createdUrl = URL.createObjectURL(blob);
        setObjUrl(createdUrl);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErrMsg(`network: ${e?.message ?? e}`);
        setObjUrl(null);
        setLoading(false);
        onError?.();
      }
    })();
    return () => {
      alive = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [url, onError]);

  const handleComplete = React.useCallback((b: NormBox) => onRegionComplete(b, page), [onRegionComplete, page]);
  const { ref, box, active, handlers } = useMarquee(handleComplete);

  return (
    <div className={className}>
      {pageCount > 1 && (
        <div className="mb-2 flex items-center gap-2 text-[12px]">
          <button type="button" className="rounded border px-2 py-0.5 disabled:opacity-40"
            disabled={page <= 0} onClick={() => onPageChange?.(page - 1)}>←</button>
          <span>Σελίδα {page + 1} / {pageCount}</span>
          <button type="button" className="rounded border px-2 py-0.5 disabled:opacity-40"
            disabled={page >= pageCount - 1} onClick={() => onPageChange?.(page + 1)}>→</button>
        </div>
      )}
      {errMsg ? (
        <div className="space-y-1 rounded border border-dg-red-500/40 bg-dg-red-500/5 p-3 text-[12px] text-dg-red-600 dark:text-dg-red-400">
          <p className="font-semibold">Δεν ήταν δυνατή η προβολή της εικόνας.</p>
          <p className="break-all font-mono text-[11px] opacity-80">{errMsg}</p>
        </div>
      ) : loading ? (
        <div className="p-3 text-[12px] text-muted-foreground">Φόρτωση…</div>
      ) : objUrl ? (
        <div ref={ref} {...(isMarking ? handlers : {})} className="relative w-full select-none"
          style={{ cursor: isMarking ? 'crosshair' : 'default', touchAction: isMarking ? 'none' : undefined }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={objUrl} alt="" className="block w-full" draggable={false} />
          {isMarking && active && box && (
            <div className="pointer-events-none absolute border-2 border-sisyphus-500 bg-sisyphus-500/10"
              style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />
          )}
          {!active && savedRegions.map((r, i) => (
            <div key={i} className="pointer-events-none absolute border-2"
              style={{
                left: `${r.bbox[0] * 100}%`, top: `${r.bbox[1] * 100}%`, width: `${r.bbox[2] * 100}%`, height: `${r.bbox[3] * 100}%`,
                borderColor: r.active ? '#E31E2A' : '#10b981',
                background: (r.active ? '#E31E2A' : '#10b981') + '1a',
              }} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
