'use client';

import * as React from 'react';
import {
  ColumnDef,
  ColumnFiltersState,
  ColumnOrderState,
  ColumnSizingState,
  ExpandedState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  FiSearch, FiChevronDown, FiChevronRight, FiArrowUp, FiArrowDown, FiArrowDownRight,
  FiColumns, FiChevronLeft, FiChevronsLeft, FiChevronsRight, FiMoreVertical, FiMove,
} from 'react-icons/fi';
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: keyof TData & string;
  searchPlaceholder?: string;
  pageSize?: number;
  expandable?: (row: TData) => React.ReactNode;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  enableSelection?: boolean;
  initialColumnVisibility?: VisibilityState;
  /** When set, column visibility + order are persisted to localStorage under this key. */
  persistKey?: string;
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Αναζήτηση...',
  pageSize = 20,
  expandable,
  emptyState,
  toolbar,
  enableSelection = false,
  initialColumnVisibility,
  persistKey,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [expanded, setExpanded] = React.useState<ExpandedState>({});
  const [globalFilter, setGlobalFilter] = React.useState('');

  // ---- Persisted state: visibility + order keyed by persistKey ----
  const visibilityKey = persistKey ? `dt:${persistKey}:visibility` : null;
  const orderKey = persistKey ? `dt:${persistKey}:order` : null;

  // SSR-safe: start with defaults so server and first client render match,
  // then hydrate from localStorage after mount.
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    initialColumnVisibility ?? {},
  );
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([]);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    if (visibilityKey) {
      try {
        const stored = window.localStorage.getItem(visibilityKey);
        if (stored) setColumnVisibility((v) => ({ ...v, ...JSON.parse(stored) }));
      } catch {}
    }
    if (orderKey) {
      try {
        const stored = window.localStorage.getItem(orderKey);
        if (stored) setColumnOrder(JSON.parse(stored));
      } catch {}
    }
    const sizeKey = persistKey ? `dt:${persistKey}:sizing` : null;
    if (sizeKey) {
      try {
        const stored = window.localStorage.getItem(sizeKey);
        if (stored) setColumnSizing(JSON.parse(stored));
      } catch {}
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (hydrated && visibilityKey) try { window.localStorage.setItem(visibilityKey, JSON.stringify(columnVisibility)); } catch {}
  }, [columnVisibility, visibilityKey, hydrated]);
  React.useEffect(() => {
    if (hydrated && orderKey) try { window.localStorage.setItem(orderKey, JSON.stringify(columnOrder)); } catch {}
  }, [columnOrder, orderKey, hydrated]);
  React.useEffect(() => {
    const sizeKey = persistKey ? `dt:${persistKey}:sizing` : null;
    if (hydrated && sizeKey) try { window.localStorage.setItem(sizeKey, JSON.stringify(columnSizing)); } catch {}
  }, [columnSizing, persistKey, hydrated]);

  const enrichedColumns = React.useMemo<ColumnDef<TData, TValue>[]>(() => {
    const cols: ColumnDef<TData, TValue>[] = [];
    if (expandable) {
      cols.push({
        id: '__expand',
        header: () => null,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); row.toggleExpanded(); }}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted dark:hover:bg-muted transition-colors"
            aria-label={row.getIsExpanded() ? 'Σύμπτυξη' : 'Επέκταση'}
          >
            {row.getIsExpanded() ? <FiChevronDown className="h-3.5 w-3.5" /> : <FiChevronRight className="h-3.5 w-3.5" />}
          </button>
        ),
        size: 32, enableResizing: false, enableSorting: false, enableHiding: false,
      } as ColumnDef<TData, TValue>);
    }
    if (enableSelection) {
      cols.push({
        id: '__select',
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Επιλογή όλων"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label="Επιλογή σειράς"
            onClick={(e) => e.stopPropagation()}
          />
        ),
        size: 32, enableResizing: false, enableSorting: false, enableHiding: false,
      } as ColumnDef<TData, TValue>);
    }
    return [...cols, ...columns];
  }, [columns, expandable, enableSelection]);

  const table = useReactTable({
    data,
    columns: enrichedColumns,
    state: { sorting, columnFilters, columnVisibility, columnSizing, columnOrder, rowSelection, expanded, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    onExpandedChange: setExpanded,
    onGlobalFilterChange: setGlobalFilter,
    columnResizeMode: 'onChange',
    enableColumnResizing: true,
    enableExpanding: !!expandable,
    getRowCanExpand: () => !!expandable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const totalRows = table.getFilteredRowModel().rows.length;
  const currentPage = table.getState().pagination.pageIndex + 1;
  const pageCount = table.getPageCount();

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[200px] max-w-sm relative">
          <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-8 h-8"
          />
        </div>
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm">
                <FiColumns /> Στήλες
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto p-2">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Εμφάνιση & σειρά στηλών</span>
                {persistKey && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      if (visibilityKey) try { window.localStorage.removeItem(visibilityKey); } catch {}
                      if (orderKey) try { window.localStorage.removeItem(orderKey); } catch {}
                      setColumnVisibility(initialColumnVisibility ?? {});
                      setColumnOrder([]);
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline"
                  >
                    reset
                  </button>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <ColumnSortableList table={table} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="relative rounded-lg border border-border dark:border-border bg-white dark:bg-card shadow-fluent-2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ tableLayout: 'fixed', width: table.getTotalSize() }}>
            <thead className="bg-muted/40 dark:bg-muted border-b border-border dark:border-input">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sort = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        style={{ width: header.getSize() }}
                        className="relative h-8 px-2.5 text-left font-semibold text-[10px] uppercase tracking-wider text-muted-foreground dark:text-muted-foreground select-none"
                      >
                        {!header.isPlaceholder && (
                          <div
                            className={cn('flex items-center gap-1.5 truncate', canSort && 'cursor-pointer hover:text-primary transition-colors')}
                            onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          >
                            <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                            {canSort && (
                              <span className="text-muted-foreground">
                                {sort === 'asc' ? <FiArrowUp className="h-3 w-3" /> :
                                  sort === 'desc' ? <FiArrowDown className="h-3 w-3" /> :
                                    <FiArrowDownRight className="h-3 w-3 opacity-40" />}
                              </span>
                            )}
                          </div>
                        )}
                        {header.column.getCanResize() && (
                          <div
                            onDoubleClick={() => header.column.resetSize()}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={cn(
                              'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none bg-transparent hover:bg-primary/40 transition-colors',
                              header.column.getIsResizing() && 'bg-primary',
                            )}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={enrichedColumns.length} className="h-32 text-center text-muted-foreground">
                    {emptyState ?? 'Δεν βρέθηκαν αποτελέσματα.'}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <React.Fragment key={row.id}>
                    <tr
                      data-state={row.getIsSelected() ? 'selected' : undefined}
                      className="border-b border-border dark:border-border last:border-0 hover:bg-muted/40 dark:hover:bg-muted/50 data-[state=selected]:bg-[var(--cx-accent-soft)]/50 dark:data-[state=selected]:bg-[var(--cx-accent-soft)]/30 transition-colors duration-200"
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isActions = cell.column.id === 'actions' || cell.column.id === '__expand' || cell.column.id === '__select';
                        return (
                          <td
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                            className={cn(
                              'h-8 px-2.5 text-[12px] text-foreground',
                              isActions ? 'overflow-visible text-center' : 'truncate',
                            )}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        );
                      })}
                    </tr>
                    {row.getIsExpanded() && expandable && (
                      <tr className="bg-muted/30 dark:bg-muted/30 border-b border-border dark:border-border animate-fade-in">
                        <td colSpan={row.getVisibleCells().length} className="px-4 py-3">
                          {expandable(row.original)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer / pagination */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border dark:border-border bg-muted/30 dark:bg-muted/30 px-3 py-2">
          <div className="text-[12px] text-muted-foreground">
            {enableSelection && Object.keys(rowSelection).length > 0 ? (
              <span>{Object.keys(rowSelection).length} επιλεγμένα από {totalRows}</span>
            ) : (
              <span>{totalRows} εγγραφές</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(table.getState().pagination.pageSize)}
              onValueChange={(v) => table.setPageSize(Number(v))}
            >
              <SelectTrigger className="h-7 w-[110px] text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 50, 100].map((s) => (
                  <SelectItem key={s} value={String(s)}>{s} / σελίδα</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[12px] text-muted-foreground px-2">
              {pageCount === 0 ? '0 / 0' : `${currentPage} / ${pageCount}`}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
              <FiChevronsLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <FiChevronLeft />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <FiChevronRight />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => table.setPageIndex(pageCount - 1)} disabled={!table.getCanNextPage()}>
              <FiChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Convenience row-action trigger that pairs with a DropdownMenu
export const RowActionsTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function RowActionsTrigger(props, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label="Ενέργειες"
        {...props}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-sm border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground hover:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground data-[state=open]:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-200',
          props.className,
        )}
      >
        <FiMoreVertical className="h-4 w-4" />
      </button>
    );
  },
);

// ---- Sortable column visibility list (used in the "Στήλες" dropdown) ----

function ColumnSortableList<T>({ table }: { table: ReturnType<typeof useReactTable<T>> }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // All columns the user is allowed to hide/reorder (skip internal __expand / __select).
  const columns = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const ids = columns.map((c) => c.id);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    // Compose the full leaf-column id list, replacing the sortable slice with the reordered one.
    const allIds = table.getAllLeafColumns().map((c) => c.id);
    const reorderedSlice = arrayMove(ids, oldIndex, newIndex);
    let cursor = 0;
    const next = allIds.map((id) => (ids.includes(id) ? reorderedSlice[cursor++] : id));
    table.setColumnOrder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col">
          {columns.map((column) => (
            <ColumnRow key={column.id} id={column.id} column={column} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function ColumnRow({ id, column }: { id: string; column: any }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const label = typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1.5 px-1 py-1 rounded-sm hover:bg-muted/60 group select-none"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground/60 hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
        aria-label="Σύρε για αναδιάταξη"
      >
        <FiMove className="size-3.5" />
      </button>
      <Checkbox
        checked={column.getIsVisible()}
        onCheckedChange={(v) => column.toggleVisibility(!!v)}
        aria-label={label}
      />
      <span
        className="text-[12px] flex-1 truncate cursor-pointer"
        onClick={() => column.toggleVisibility(!column.getIsVisible())}
      >
        {label}
      </span>
    </li>
  );
}
