// lib/ocr/region-text.ts
export interface TextItem { str: string; x: number; y: number; w: number; h: number; }
export interface Box { x: number; y: number; w: number; h: number; }

/** Join the text of items whose centre lies within the box (reading order). */
export function textInBox(items: TextItem[], box: Box): string {
  const inside = items.filter((it) => {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  });
  inside.sort((a, b) => (Math.abs(a.y - b.y) > 0.01 ? a.y - b.y : a.x - b.x));
  return inside.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
}
