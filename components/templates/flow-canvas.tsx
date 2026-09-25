'use client';

// The pipeline diagram, shared by the designer side panel (vertical) and the document
// run card (horizontal). It owns only rendering: the node/edge model comes from
// `buildFlow` and the pixel layout from `layoutFlow`, both pure and tested.
// Deliberately free of `useDesigner` — the document page has no designer context.

import * as React from 'react';
import { ReactFlow, Background, Controls, Handle, Position, useReactFlow, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FiCpu, FiFileText, FiGitBranch, FiImage, FiUploadCloud } from 'react-icons/fi';
import { buildFlow, layoutFlow, toFlowTemplate, type FlowOrientation, type FlowRun, type FlowScores, type FlowTemplateSource } from '@/lib/templates/flow';
import { pctText, SCORE_STYLE, scoreTone } from '@/lib/templates/training-view';

type D = Record<string, unknown>;
const card = 'rounded-md border bg-white px-2.5 py-2 text-[length:var(--fs-11)] shadow-fluent-2 min-w-[150px] max-w-[170px]';

/** Nodes read the reading direction from context so they need no extra props through React Flow. */
const OrientationContext = React.createContext<FlowOrientation>('vertical');
function useHandles(): { target: Position; source: Position } {
  const o = React.useContext(OrientationContext);
  return o === 'horizontal' ? { target: Position.Left, source: Position.Right } : { target: Position.Top, source: Position.Bottom };
}

function SampleNode({ data }: NodeProps<Node<D>>) {
  const h = useHandles();
  const subtitle = data.subtitle as string | null;
  return (
    <div className={`${card} border-border`}>
      <Handle type="source" position={h.source} />
      <div className="flex items-center gap-1.5 font-semibold truncate"><FiImage className="size-3.5 shrink-0 text-sisyphus-600" /> <span className="truncate">{String(data.label)}</span></div>
      {subtitle && <div className="text-muted-foreground truncate">{subtitle}</div>}
      <div className="text-muted-foreground truncate">{Number(data.pageCount)} σελίδ{Number(data.pageCount) === 1 ? 'α' : 'ες'}</div>
    </div>);
}
/** Ο βαθμός εκπαίδευσης του πεδίου (spec §11) — μικρό chip, με τίτλο που λέει σε πόσα δείγματα. */
function ScoreBadge({ score, ok, total }: { score: number; ok: number; total: number }) {
  const tone = SCORE_STYLE[scoreTone(score)];
  return (
    <span
      className="shrink-0 rounded-full px-1.5 text-[length:var(--fs-9)] font-semibold"
      style={{ backgroundColor: tone.bg, color: tone.fg }}
      title={`Βαθμός εκπαίδευσης ${pctText(score)} — σωστό σε ${ok} από ${total} επιβεβαιωμένα δείγματα`}
    >
      {pctText(score)}
    </span>
  );
}

function FieldNode({ data }: NodeProps<Node<D>>) {
  const h = useHandles();
  const color = String(data.color); const status = data.status as string | undefined;
  const score = typeof data.score === 'number' ? data.score : null;
  return (
    <div className={`${card} ${data.focused ? 'border-sisyphus-500' : 'border-border'}`} style={{ borderLeft: `4px solid ${color}` }}>
      <Handle type="target" position={h.target} /><Handle type="source" position={h.source} />
      <div className="flex items-center gap-1.5 font-semibold truncate" style={{ color }}><span className="truncate">{String(data.label)}</span>{status && <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[length:var(--fs-9)] ${status === 'ok' ? 'bg-[#E8F7F0] text-[#047857]' : 'bg-[#FFF1E6] text-[#C2410C]'}`}>{status === 'ok' ? 'ok' : 'κενό'}</span>}</div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground truncate">{data.kind === 'TABLE' ? 'πίνακας' : 'τιμή'}{data.hasRegion ? ` · σ.${Number(data.page) + 1}` : ' · χωρίς περιοχή'}</span>
        {score != null && <ScoreBadge score={score} ok={Number(data.scoreOk)} total={Number(data.scoreTotal)} />}
      </div>
      {data.value != null && <div className="mt-0.5 truncate font-mono text-[length:var(--fs-10)]">{String(data.value)}</div>}
    </div>);
}
function ConditionNode({ data }: NodeProps<Node<D>>) {
  const h = useHandles();
  const matched = data.matched as boolean | undefined;
  return (
    <div className={`${card} ${matched === true ? 'border-[#047857]' : 'border-border'}`}>
      <Handle type="target" position={h.target} /><Handle type="source" position={h.source} />
      <div className="flex items-center gap-1.5 font-semibold truncate"><FiGitBranch className="size-3.5 shrink-0 text-[#B45309]" /> <span className="truncate">{String(data.label)}</span></div>
      <div className="text-muted-foreground truncate">{Number(data.clauses)} ρήτρ{Number(data.clauses) === 1 ? 'α' : 'ες'} · {(data.actions as string[]).length} ενέργ.</div>
    </div>);
}
function MappingNode({ data }: NodeProps<Node<D>>) {
  const h = useHandles();
  return (
    <div className={`${card} ${data.active ? 'border-sisyphus-500' : 'border-border'}`}>
      <Handle type="target" position={h.target} /><Handle type="source" position={h.source} />
      <div className="flex items-center gap-1.5 font-semibold truncate"><FiFileText className="size-3.5 shrink-0 text-sisyphus-600" /> <span className="truncate">{String(data.label)}</span></div>
      <div className="text-muted-foreground truncate">{Number(data.rows)} αντιστοιχίσεις</div>
    </div>);
}
function OutputNode({ data }: NodeProps<Node<D>>) {
  const h = useHandles();
  return (
    <div className={`${card} border-border bg-neutral-4`}>
      <Handle type="target" position={h.target} />
      <div className="flex items-center gap-1.5 font-semibold truncate">{data.mode === 'AUTO' ? <FiUploadCloud className="size-3.5 shrink-0 text-[#047857]" /> : <FiCpu className="size-3.5 shrink-0 text-muted-foreground" />} <span className="truncate">{String(data.label)}</span></div>
      {data.runStatus != null && <div className="text-muted-foreground truncate">τελευταία: {String(data.runStatus)}</div>}
    </div>);
}
const nodeTypes = { sample: SampleNode, field: FieldNode, condition: ConditionNode, mapping: MappingNode, output: OutputNode };

/** Re-fits after the diagram changes shape (a new run adds values/badges and can resize nodes). */
function FitOnChange({ token }: { token: string }) {
  const { fitView } = useReactFlow();
  React.useEffect(() => {
    // One frame late: React Flow needs the new nodes measured before it can fit them.
    const t = window.setTimeout(() => { void fitView({ padding: 0.15 }); }, 0);
    return () => window.clearTimeout(t);
  }, [token, fitView]);
  return null;
}

export type FlowCanvasProps = {
  template: FlowTemplateSource;
  /** Live run overlay — values, matched conditions, active mapping, status. */
  run?: FlowRun;
  /** Βαθμοί εκπαίδευσης ανά πεδίο (spec §11) — ένα chip πάνω στον κόμβο του πεδίου. */
  scores?: FlowScores;
  orientation: FlowOrientation;
  onNodeClick?: (node: { id: string; type: string; data: Record<string, unknown> }) => void;
  /** Field key to highlight (designer list ⇄ canvas ⇄ flow). */
  focusKey?: string | null;
  /**
   * Re-fit the viewport whenever the diagram changes shape, not just on mount. On for the run card,
   * where a new run adds values and badges that resize the nodes; off for the designer panel, where
   * every keystroke would otherwise yank back a viewport the user just panned.
   */
  refitOnChange?: boolean;
  className?: string;
};

export function FlowCanvas({ template, run, scores, orientation, onNodeClick, focusKey, refitOnChange = false, className }: FlowCanvasProps) {
  const { nodes, edges } = React.useMemo(() => buildFlow(toFlowTemplate(template), run, scores), [template, run, scores]);
  const rfNodes = React.useMemo<Node<D>[]>(
    () => layoutFlow(nodes, orientation).map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: focusKey && n.id === `field:${focusKey}` ? { ...n.data, focused: true } : n.data,
      draggable: false,
    })),
    [nodes, orientation, focusKey],
  );
  const rfEdges = React.useMemo<Edge[]>(() => edges.map((e) => ({ ...e, type: 'smoothstep' })), [edges]);
  const fitToken = `${orientation}|${rfNodes.length}|${run?.status ?? ''}|${run?.mappingName ?? ''}|${run?.matchedIds.join(',') ?? ''}`;

  const handleNodeClick = React.useCallback(
    (_: React.MouseEvent, node: Node) => onNodeClick?.({ id: node.id, type: String(node.type), data: (node.data ?? {}) as Record<string, unknown> }),
    [onNodeClick],
  );

  return (
    <OrientationContext.Provider value={orientation}>
      <div className={className ?? 'h-full w-full'} data-testid="flow-canvas" data-orientation={orientation}>
        <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodeClick={onNodeClick ? handleNodeClick : undefined} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable={false} elementsSelectable={false} minZoom={0.2}>
          <Background gap={16} color="#EDEBE9" />
          <Controls showInteractive={false} />
          {refitOnChange && <FitOnChange token={fitToken} />}
        </ReactFlow>
      </div>
    </OrientationContext.Provider>
  );
}
