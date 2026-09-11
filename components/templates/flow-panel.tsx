'use client';

// Designer side panel — a thin wrapper that wires the shared canvas to the designer
// context: vertical reading direction, node click jumps to the owning step.

import * as React from 'react';
import { FlowCanvas } from './flow-canvas';
import { useDesigner } from './designer-context';

export function FlowPanel() {
  const { dto, focusKey, setFocusKey, goToStep, scores } = useDesigner();

  const onNodeClick = React.useCallback((node: { id: string }) => {
    if (node.id === 'sample') goToStep(1);
    else if (node.id.startsWith('field:')) { setFocusKey(node.id.slice(6)); goToStep(2); }
    else if (node.id.startsWith('map:')) goToStep(3);
    else if (node.id.startsWith('cond:') || node.id === 'output') goToStep(4);
  }, [goToStep, setFocusKey]);

  return (
    <div className="h-full w-full" data-testid="flow-panel">
      <FlowCanvas template={dto} scores={scores} orientation="vertical" onNodeClick={onNodeClick} focusKey={focusKey} />
    </div>
  );
}
