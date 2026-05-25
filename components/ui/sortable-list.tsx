'use client';

import * as React from 'react';
import {
  DndContext, DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FiMenu } from 'react-icons/fi';
import { cn } from '@/lib/utils';

export type SortableItem = { id: string };

interface SortableListProps<T extends SortableItem> {
  items: T[];
  renderItem: (item: T, dragHandle: React.ReactNode) => React.ReactNode;
  onReorder: (newOrder: T[]) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

export function SortableList<T extends SortableItem>({
  items, renderItem, onReorder, disabled, className,
}: SortableListProps<T>) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => { setMounted(true); }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    onReorder(next);
  };

  // SSR + first client render: render non-DnD placeholder to avoid dnd-kit
  // generating non-deterministic `DndDescribedBy-N` ids that mismatch hydration.
  if (disabled || !mounted) {
    return (
      <ul className={cn('space-y-1', className)}>
        {items.map((item) => (
          <li key={item.id}>
            {renderItem(item, (
              <span
                aria-hidden
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground"
              >
                <FiMenu className="h-3.5 w-3.5" />
              </span>
            ))}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ul className={cn('space-y-1', className)}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {(handle) => renderItem(item, handle)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const handle = (
    <button
      type="button"
      className="inline-flex h-6 w-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted active:cursor-grabbing transition-colors duration-200"
      aria-label="Σύρε για αλλαγή σειράς"
      {...attributes}
      {...listeners}
    >
      <FiMenu className="h-3.5 w-3.5" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md transition-shadow duration-200',
        isDragging && 'shadow-fluent-16 ring-1 ring-ring z-10 relative',
      )}
    >
      {children(handle)}
    </li>
  );
}
