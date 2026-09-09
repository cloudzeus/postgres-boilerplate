'use client';

import * as React from 'react';
import { ReactFlow, Background, Controls, Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { FiCpu, FiFileText, FiGitBranch, FiImage, FiUploadCloud } from 'react-icons/fi';
import { buildFlow, toFlowTemplate } from '@/lib/templates/flow';
import { useDesigner } from './designer-context';

type D = Record<string, unknown>;
const card = 'rounded-md border bg-white px-2.5 py-2 text-[11px] shadow-fluent-2 min-w-[150px] max-w-[170px]';

function SampleNode({ data }: NodeProps<Node<D>>) {
  return <div className={`${card} border-border`}><Handle type="source" position={Position.Bottom} /><div className="flex items-center gap-1.5 font-semibold truncate"><FiImage className="size-3.5 shrink-0 text-sisyphus-600" /> <span className="truncate">{String(data.label)}</span></div><div className="text-muted-foreground truncate">{Number(data.pageCount)} σελίδ{Number(data.pageCount) === 1 ? 'α' : 'ες'}</div></div>;
}
function FieldNode({ data }: NodeProps<Node<D>>) {
  const color = String(data.color); const status = data.status as string | undefined;
  return (
    <div className={`${card} border-border`} style={{ borderLeft: `4px solid ${color}` }}>
      <Handle type="target" position={Position.Top} /><Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-1.5 font-semibold truncate" style={{ color }}><span className="truncate">{String(data.label)}</span>{status && <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[9px] ${status === 'ok' ? 'bg-[#E8F7F0] text-[#047857]' : 'bg-[#FFF1E6] text-[#C2410C]'}`}>{status === 'ok' ? 'ok' : 'κενό'}</span>}</div>
      <div className="text-muted-foreground truncate">{data.kind === 'TABLE' ? 'πίνακας' : 'τιμή'}{data.hasRegion ? ` · σ.${Number(data.page) + 1}` : ' · χωρίς περιοχή'}</div>
      {data.value != null && <div className="mt-0.5 truncate font-mono text-[10px]">{String(data.value)}</div>}
    </div>);
}
function ConditionNode({ data }: NodeProps<Node<D>>) {
  const matched = data.matched as boolean | undefined;
  return (
    <div className={`${card} ${matched === true ? 'border-[#047857]' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} /><Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-1.5 font-semibold truncate"><FiGitBranch className="size-3.5 shrink-0 text-[#B45309]" /> <span className="truncate">{String(data.label)}</span></div>
      <div className="text-muted-foreground truncate">{Number(data.clauses)} ρήτρ{Number(data.clauses) === 1 ? 'α' : 'ες'} · {(data.actions as string[]).length} ενέργ.</div>
    </div>);
}
function MappingNode({ data }: NodeProps<Node<D>>) {
  return (
    <div className={`${card} ${data.active ? 'border-sisyphus-500' : 'border-border'}`}>
      <Handle type="target" position={Position.Top} /><Handle type="source" position={Position.Bottom} />
      <div className="flex items-center gap-1.5 font-semibold truncate"><FiFileText className="size-3.5 shrink-0 text-sisyphus-600" /> <span className="truncate">{String(data.label)}</span></div>
      <div className="text-muted-foreground truncate">{Number(data.rows)} αντιστοιχίσεις</div>
    </div>);
}
function OutputNode({ data }: NodeProps<Node<D>>) {
  return (
    <div className={`${card} border-border bg-neutral-4`}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5 font-semibold truncate">{data.mode === 'AUTO' ? <FiUploadCloud className="size-3.5 shrink-0 text-[#047857]" /> : <FiCpu className="size-3.5 shrink-0 text-muted-foreground" />} <span className="truncate">{String(data.label)}</span></div>
      {data.runStatus != null && <div className="text-muted-foreground truncate">τελευταία: {String(data.runStatus)}</div>}
    </div>);
}
const nodeTypes = { sample: SampleNode, field: FieldNode, condition: ConditionNode, mapping: MappingNode, output: OutputNode };

/** Nodes per line before a column wraps (5 × 190px ≈ 950px, the widest we let the panel get). */
const PER_ROW = 5;

export function FlowPanel() {
  const { dto, setFocusKey, goToStep } = useDesigner();
  const { nodes, edges } = React.useMemo(() => buildFlow(toFlowTemplate(dto)), [dto]);
  const rfNodes = React.useMemo<Node<D>[]>(() => {
    // The pure buildFlow layout is 5 columns left→right, meant for a wide canvas.
    // Transpose it for the narrow side panel: columns become rows (top→bottom),
    // and rows within a column become horizontal position, centred under the column.
    // A column of more than PER_ROW nodes wraps onto further lines, so a template with
    // a dozen fields stays inside ~950px instead of running off to the right.
    const countByCol = new Map<number, number>();
    for (const n of nodes) {
      const col = Math.round(n.position.x / 260);
      countByCol.set(col, (countByCol.get(col) ?? 0) + 1);
    }
    // Stack the columns cumulatively: a wrapped column is taller than one line, and a
    // flat `col * 120` would drop the next column on top of its second line.
    const topByCol = new Map<number, number>();
    let top = 0;
    for (const col of [...countByCol.keys()].sort((a, b) => a - b)) {
      topByCol.set(col, top);
      top += 120 + (Math.ceil((countByCol.get(col) ?? 1) / PER_ROW) - 1) * 90;
    }
    return nodes.map((n) => {
      const col = Math.round(n.position.x / 260);
      const row = Math.round(n.position.y / 96);
      const count = countByCol.get(col) ?? 1;
      const x = (row % PER_ROW) * 190 - (Math.min(count, PER_ROW) - 1) * 95;
      const y = (topByCol.get(col) ?? 0) + Math.floor(row / PER_ROW) * 90;
      return { id: n.id, type: n.type, position: { x, y }, data: n.data, draggable: false };
    });
  }, [nodes]);
  const rfEdges = React.useMemo<Edge[]>(() => edges.map((e) => ({ ...e, type: 'smoothstep' })), [edges]);

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    if (node.id === 'sample') goToStep(1);
    else if (node.id.startsWith('field:')) { setFocusKey(node.id.slice(6)); goToStep(2); }
    else if (node.id.startsWith('map:')) goToStep(3);
    else if (node.id.startsWith('cond:') || node.id === 'output') goToStep(4);
  };

  return (
    <div className="h-full w-full" data-testid="flow-panel">
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} fitView fitViewOptions={{ padding: 0.15 }} nodesConnectable={false} elementsSelectable={false} minZoom={0.2}>
        <Background gap={16} color="#EDEBE9" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
