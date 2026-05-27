'use client';

import * as React from 'react';
import { FiChevronRight, FiChevronDown, FiLoader, FiEdit2, FiTrash2 } from 'react-icons/fi';
import { Checkbox } from '@/components/ui/checkbox';

export type KadTreeNodeData = {
  code: string;
  title: string;
  level: number | null;
  sector: string | null;
  parentCode: string | null;
  directChildren: number;
  descendants: number;
  hasChildren: boolean;
};

const levelLabels: Record<number, string> = {
  1: 'Τομέας', 2: 'Κλάδος', 3: 'Ομάδα', 4: 'Τάξη NACE',
  5: 'Κατηγορία', 6: 'Υποκατηγορία', 7: 'Δραστηριότητα',
};

// Outline color band per level depth (matches screenshot pattern: blue → green → purple)
function levelStyles(level: number | null) {
  if (level == null) return { border: 'border-slate-300', badge: 'bg-slate-100 text-slate-700 border-slate-200' };
  if (level <= 3)  return { border: 'border-blue-300',   badge: 'bg-blue-100 text-blue-800 border-blue-200' };
  if (level <= 5)  return { border: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  return                  { border: 'border-purple-300', badge: 'bg-purple-100 text-purple-800 border-purple-200' };
}

export function KadTree({ initialRoots }: { initialRoots: KadTreeNodeData[] }) {
  return (
    <ul className="space-y-1.5">
      {initialRoots.map((r) => <KadNode key={r.code} node={r} depth={0} />)}
    </ul>
  );
}

function KadNode({ node, depth }: { node: KadTreeNodeData; depth: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [children, setChildren] = React.useState<KadTreeNodeData[] | null>(null);
  const styles = levelStyles(node.level);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.hasChildren) return;
    if (!expanded && !children) {
      setLoading(true);
      try {
        const res = await fetch(`/api/kad/children?parent=${encodeURIComponent(node.code)}`);
        const data = await res.json();
        setChildren(data.nodes ?? []);
      } finally { setLoading(false); }
    }
    setExpanded((v) => !v);
  };

  return (
    <li>
      <div
        className={`group flex items-center gap-2 rounded-lg border-2 ${styles.border} bg-white px-2.5 py-1.5 hover:shadow-sm transition-shadow`}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={node.hasChildren ? (expanded ? 'collapse' : 'expand') : 'leaf'}
          className="w-5 h-5 flex items-center justify-center text-slate-500 disabled:opacity-30"
          disabled={!node.hasChildren}
        >
          {loading ? <FiLoader className="animate-spin" /> :
            node.hasChildren ? (expanded ? <FiChevronDown /> : <FiChevronRight />) : <span className="w-2 h-2" />}
        </button>

        <Checkbox onClick={(e) => e.stopPropagation()} />

        <span className="font-mono text-[11px] tabular-nums text-slate-500 w-24 shrink-0">{node.code}</span>
        <span className="text-[11px] font-medium uppercase truncate text-slate-700">{node.title}</span>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {node.level != null && (
            <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${styles.badge}`}>
              {levelLabels[node.level] ?? `L${node.level}`}
            </span>
          )}
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
            {node.descendants.toLocaleString('el-GR')} ΚΑΔ
          </span>
          <span className="px-2 py-0.5 rounded text-[11px] text-slate-600 bg-slate-50 border border-slate-200">
            {node.directChildren} άμεσα
          </span>
          {node.sector && (
            <span className="px-2 py-0.5 rounded text-[11px] text-slate-600 bg-slate-50 border border-slate-200">
              Τομέας {node.sector}
            </span>
          )}
          <button type="button" className="p-1 text-slate-400 hover:text-slate-700" aria-label="edit">
            <FiEdit2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" className="p-1 text-rose-400 hover:text-rose-600" aria-label="delete">
            <FiTrash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && children && children.length > 0 && (
        <ul className="space-y-1.5 mt-1.5" style={{ paddingLeft: `${(depth + 1) * 20}px` }}>
          {children.map((c) => <KadNode key={c.code} node={c} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}
