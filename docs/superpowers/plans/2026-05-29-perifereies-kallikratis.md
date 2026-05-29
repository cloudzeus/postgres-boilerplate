# Περιφέρειες (Καλλικράτης) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Καλλικράτης "Περιφέρειες" reference registry (Περιφέρεια → Περιφερειακή Ενότητα/Νομός → Δήμος), mirror the ΚΑΔ UI, associate company/branch addresses to a Δήμος node, and auto-detect that node on create/update.

**Architecture:** A self-referential `Region` model (same shape as `KadCode`) seeded from `public/periferies-2026-05-28.json`. `Company` and `CompanyBranch` get one nullable `regionCode` FK to the Δήμος-level node; the full chain is derived by walking parents. A hybrid matcher (name match → geo fallback via the existing MapTiler geocoder) fills `regionCode` automatically in the company/branch APIs and on demand from the UI. A read-only tree browser at `/admin/regions` clones the ΚΑΔ page, with a sidebar link and wiki entry.

**Tech Stack:** Next.js 16 (App Router), Prisma + MySQL, React + Tailwind + shadcn/ui, react-icons, MapTiler geocoding, vitest (new, for pure-logic unit tests).

---

## File Structure

**New files:**
- `prisma/seeds/regions.ts` — seed from JSON (drops JSON id/dates)
- `lib/regions/tree.ts` — `RegionBreadcrumb` type, `buildBreadcrumb` (pure), `deriveHierarchy` (DB)
- `lib/regions/match.ts` — `normalizeGreek`, `coreName`, `nameMatchCandidate`, `haversineKm`, `nearestNode` (pure) + `matchRegion` (orchestrator)
- `lib/regions/decoder.ts` — `decodeRegion` for the browser page
- `lib/regions/__tests__/match.test.ts`, `lib/regions/__tests__/tree.test.ts` — vitest unit tests
- `app/api/regions/children/route.ts`
- `app/api/regions/decode/route.ts`
- `app/api/regions/match/route.ts`
- `components/regions/region-tree.tsx`
- `components/regions/region-decoder.tsx`
- `components/regions/region-picker.tsx`
- `components/regions/region-field.tsx` — breadcrumb + detect + picker, reused by company form
- `app/admin/regions/page.tsx`
- `docs/wiki/mitroa/perifereies.mdx` (via `wiki:new`)
- `vitest.config.ts`

**Modified files:**
- `prisma/schema.prisma` — add `Region`; add `regionCode`/`regionRef` to `Company` and `CompanyBranch`
- `package.json` — add `test` + `seed:regions` scripts, vitest devDeps
- `components/admin/sidebar.tsx` — add "Μητρώο Περιφερειών" link (after line 49)
- `app/api/admin/companies/route.ts` — `regionCode` in schema + auto-fill on POST
- `app/api/admin/companies/[id]/route.ts` — `regionCode` in schema + auto-fill on PATCH
- `app/api/admin/companies/[id]/branches/route.ts` — `regionCode` in schema + auto-fill on POST
- `app/api/admin/companies/[id]/branches/[branchId]/route.ts` — `regionCode` in schema + auto-fill on PATCH
- `app/admin/companies/companies-view.tsx` — region field in form, actions-dropdown item, save wiring
- `app/admin/companies/page.tsx` — pass `regionCode` through to the client view
- `lib/wiki/modules-meta.ts` + `lib/wiki/types.ts` — register `mitroa` module

---

## Task 1: Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the `Region` model**

Add after the `Municipality` model block (near line 412 in `prisma/schema.prisma`):

```prisma
// Καλλικράτης δενδροειδής δομή — seed από public/periferies-*.json (όχι GEMI).
model Region {
  code        String   @id            // "111" (Περιφ.), "11102" (Π.Ε./Νομός), "1110202" (Δήμος)
  nameEL      String
  nameEN      String?
  level       Int                      // 3=Περιφέρεια, 4=Περιφ. Ενότητα/Νομός, 5=Δήμος
  parentCode  String?
  parent      Region?  @relation("RegionHierarchy", fields: [parentCode], references: [code], onDelete: SetNull)
  children    Region[] @relation("RegionHierarchy")
  path        String?                  // "111>11102>1110202"
  latitude    Float?
  longitude   Float?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  companies       Company[]       @relation("CompanyRegion")
  companyBranches CompanyBranch[] @relation("BranchRegion")

  @@index([parentCode])
  @@index([level])
  @@index([nameEL])
}
```

- [ ] **Step 2: Add `regionCode` to `Company`**

In the `Company` model, next to the existing `municipalityId`/`municipalityRef` lines (around line 82-83), add:

```prisma
  regionCode        String?
  regionRef         Region?           @relation("CompanyRegion", fields: [regionCode], references: [code])
```

And add to the `Company` model's index block (near line 100-101):

```prisma
  @@index([regionCode])
```

- [ ] **Step 3: Add `regionCode` to `CompanyBranch`**

In the `CompanyBranch` model (around line 621-650), add next to the other scalar fields:

```prisma
  regionCode    String?
  regionRef     Region?  @relation("BranchRegion", fields: [regionCode], references: [code])
```

And in its index block:

```prisma
  @@index([regionCode])
```

- [ ] **Step 4: Create the migration**

Run: `npx prisma migrate dev --name add_region_kallikratis`
Expected: migration created and applied; `prisma generate` runs; no errors. (If the DB is unreachable, use `npx prisma migrate dev --create-only --name add_region_kallikratis` then apply when DB is up.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(regions): add Region model + regionCode FKs on Company/CompanyBranch"
```

---

## Task 2: Seed script + npm script

**Files:**
- Create: `prisma/seeds/regions.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the seed script**

Create `prisma/seeds/regions.ts`:

```ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../lib/db';

type RawNode = {
  id?: string;          // ignored — we generate our own PK (code) & dates
  code: string;
  nameEL: string;
  nameEN: string | null;
  level: number;
  parentCode: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt?: string;   // ignored
  updatedAt?: string;   // ignored
  children?: RawNode[];
};

type FlatRegion = {
  code: string;
  nameEL: string;
  nameEN: string | null;
  level: number;
  parentCode: string | null;
  latitude: number | null;
  longitude: number | null;
  path: string;
};

function flatten(node: RawNode, pathParts: string[], out: FlatRegion[]) {
  const path = [...pathParts, node.code].join('>');
  out.push({
    code: node.code,
    nameEL: node.nameEL,
    nameEN: node.nameEN ?? null,
    level: node.level,
    parentCode: node.parentCode ?? null,
    latitude: node.latitude ?? null,
    longitude: node.longitude ?? null,
    path,
  });
  for (const child of node.children ?? []) {
    flatten(child, [...pathParts, node.code], out);
  }
}

async function main() {
  const jsonPath = path.join(process.cwd(), 'public', 'periferies-2026-05-28.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as RawNode[];

  const flat: FlatRegion[] = [];
  for (const root of raw) flatten(root, [], flat);
  console.log(`Flattened ${flat.length} region nodes from ${raw.length} top-level regions`);

  // Parents-first to satisfy the self-FK.
  flat.sort((a, b) => a.level - b.level);

  const BATCH = 100;
  let written = 0;
  for (let i = 0; i < flat.length; i += BATCH) {
    const slice = flat.slice(i, i + BATCH);
    await Promise.all(
      slice.map((r) =>
        prisma.region.upsert({
          where: { code: r.code },
          create: {
            code: r.code,
            nameEL: r.nameEL,
            nameEN: r.nameEN,
            level: r.level,
            parentCode: r.parentCode,
            latitude: r.latitude,
            longitude: r.longitude,
            path: r.path,
            isActive: true,
          },
          update: {
            nameEL: r.nameEL,
            nameEN: r.nameEN,
            level: r.level,
            parentCode: r.parentCode,
            latitude: r.latitude,
            longitude: r.longitude,
            path: r.path,
          },
        }),
      ),
    );
    written += slice.length;
  }
  console.log(`Upserted ${written}/${flat.length} regions. Done.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "seed:regions": "tsx prisma/seeds/regions.ts",
```

- [ ] **Step 3: Run the seed**

Run: `npm run seed:regions`
Expected: `Flattened 415 region nodes from 14 top-level regions` then `Upserted 415/415`.

- [ ] **Step 4: Verify counts and that JSON id/dates were NOT kept**

Run:
```bash
npx tsx -e "import {prisma} from './lib/db'; (async()=>{const g=await prisma.region.groupBy({by:['level'],_count:true}); console.log(g); const a=await prisma.region.findUnique({where:{code:'111'}}); console.log('id-is-code:', a?.code==='111', 'createdAt-fresh:', !!a?.createdAt); await prisma.\$disconnect();})()"
```
Expected: counts `level 3 → 14`, `level 4 → 75`, `level 5 → 326`; `id-is-code: true`; `createdAt-fresh: true`.

- [ ] **Step 5: Commit**

```bash
git add prisma/seeds/regions.ts package.json
git commit -m "feat(regions): seed Region tree from periferies JSON"
```

---

## Task 3: vitest setup + `lib/regions/tree.ts` (TDD)

**Files:**
- Create: `vitest.config.ts`, `lib/regions/tree.ts`, `lib/regions/__tests__/tree.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest and add the test script**

Run: `npm install -D vitest`
Then add to `package.json` `"scripts"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { include: ['lib/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

- [ ] **Step 3: Write the failing test for `buildBreadcrumb`**

Create `lib/regions/__tests__/tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildBreadcrumb } from '@/lib/regions/tree';

describe('buildBreadcrumb', () => {
  it('keys an ordered Δήμος chain into region/regionalUnit/municipality', () => {
    const chain = [
      { code: '111', nameEL: 'ΠΕΡΙΦΕΡΕΙΑ ΑΝΑΤΟΛΙΚΗΣ ΜΑΚΕΔΟΝΙΑΣ ΚΑΙ ΘΡΑΚΗΣ', level: 3 },
      { code: '11102', nameEL: 'ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ', level: 4 },
      { code: '1110202', nameEL: 'ΔΗΜΟΣ ΔΟΞΑΤΟΥ', level: 5 },
    ];
    const b = buildBreadcrumb(chain);
    expect(b.region?.code).toBe('111');
    expect(b.regionalUnit?.code).toBe('11102');
    expect(b.municipality?.nameEL).toBe('ΔΗΜΟΣ ΔΟΞΑΤΟΥ');
  });

  it('leaves municipality null when the chain only reaches a Π.Ε.', () => {
    const chain = [
      { code: '111', nameEL: 'ΠΕΡΙΦΕΡΕΙΑ Α.Μ.Θ.', level: 3 },
      { code: '11102', nameEL: 'ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ', level: 4 },
    ];
    const b = buildBreadcrumb(chain);
    expect(b.regionalUnit?.code).toBe('11102');
    expect(b.municipality).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tree`
Expected: FAIL — `buildBreadcrumb` not exported / module missing.

- [ ] **Step 5: Implement `lib/regions/tree.ts`**

```ts
import { prisma } from '@/lib/db';

export type RegionRef = { code: string; nameEL: string };

export type RegionBreadcrumb = {
  region: RegionRef | null;        // level 3
  regionalUnit: RegionRef | null;  // level 4 (Περιφερειακή Ενότητα / Νομός)
  municipality: RegionRef | null;  // level 5 (Δήμος)
};

export type RegionChainNode = { code: string; nameEL: string; level: number };

/** Pure: map an ordered (root→leaf) chain into the breadcrumb by level. */
export function buildBreadcrumb(chain: RegionChainNode[]): RegionBreadcrumb {
  const byLevel = (lvl: number) => {
    const n = chain.find((c) => c.level === lvl);
    return n ? { code: n.code, nameEL: n.nameEL } : null;
  };
  return {
    region: byLevel(3),
    regionalUnit: byLevel(4),
    municipality: byLevel(5),
  };
}

/** Walk up the parent chain from a node code, then build the breadcrumb. */
export async function deriveHierarchy(code: string): Promise<RegionBreadcrumb> {
  const chain: RegionChainNode[] = [];
  let current: string | null = code;
  for (let i = 0; i < 8 && current; i++) {
    const node = await prisma.region.findUnique({
      where: { code: current },
      select: { code: true, nameEL: true, level: true, parentCode: true },
    });
    if (!node) break;
    chain.unshift({ code: node.code, nameEL: node.nameEL, level: node.level });
    current = node.parentCode;
  }
  return buildBreadcrumb(chain);
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- tree`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json package-lock.json lib/regions/tree.ts lib/regions/__tests__/tree.test.ts
git commit -m "feat(regions): breadcrumb derivation + vitest setup"
```

---

## Task 4: `lib/regions/match.ts` — hybrid matcher with ΓΕΜΗ/ΑΑΔΕ priority (TDD on pure core)

**Files:**
- Create: `lib/regions/match.ts`, `lib/regions/__tests__/match.test.ts`

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `lib/regions/__tests__/match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeGreek, coreName, nameMatchCandidate, haversineKm, nearestNode } from '@/lib/regions/match';

const NODES = [
  { code: '1110202', nameEL: 'ΔΗΜΟΣ ΔΟΞΑΤΟΥ', latitude: 41.0595867, longitude: 24.2227293 },
  { code: '0511', nameEL: 'ΔΗΜΟΣ ΑΘΗΝΑΙΩΝ', latitude: 37.9838, longitude: 23.7275 },
  { code: '9919901', nameEL: 'ΑΓΙΟ ΟΡΟΣ (Αυτοδιοίκητο)', latitude: 40.28, longitude: 24.18 },
];

// Level-4 nodes (Περιφερειακές Ενότητες / Νομοί) for ΓΕΜΗ prefecture matching
const UNITS = [
  { code: '11102', nameEL: 'ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ' },
];

describe('normalizeGreek', () => {
  it('uppercases, strips accents and final sigma differences', () => {
    expect(normalizeGreek('Δοξάτο')).toBe('ΔΟΞΑΤΟ');
    expect(normalizeGreek('  αθηνα ')).toBe('ΑΘΗΝΑ');
  });
});

describe('coreName', () => {
  it('drops admin prefixes (ΔΗΜΟΣ / Δ. / ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ / ΝΟΜΟΣ) and parentheticals', () => {
    expect(coreName('ΔΗΜΟΣ ΔΟΞΑΤΟΥ')).toBe('ΔΟΞΑΤΟΥ');
    expect(coreName('ΑΓΙΟ ΟΡΟΣ (Αυτοδιοίκητο)')).toBe('ΑΓΙΟ ΟΡΟΣ');
    expect(coreName('ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ ΔΡΑΜΑΣ')).toBe('ΔΡΑΜΑΣ');
    expect(coreName('ΝΟΜΟΣ ΔΡΑΜΑΣ')).toBe('ΔΡΑΜΑΣ');
  });
});

describe('nameMatchCandidate against level-4 (ΓΕΜΗ prefecture descr)', () => {
  it('matches a ΓΕΜΗ νομός name "ΔΡΑΜΑΣ" to the Περιφερειακή Ενότητα', () => {
    expect(nameMatchCandidate('ΔΡΑΜΑΣ', UNITS)).toBe('11102');
  });
});

describe('nameMatchCandidate', () => {
  it('matches genitive municipality names from a nominative city (Δοξάτο → ΔΟΞΑΤΟΥ)', () => {
    expect(nameMatchCandidate('Δοξάτο', NODES)).toBe('1110202');
  });
  it('matches Αθήνα → ΔΗΜΟΣ ΑΘΗΝΑΙΩΝ via shared stem', () => {
    expect(nameMatchCandidate('Αθήνα', NODES)).toBe('0511');
  });
  it('returns null for an unknown place', () => {
    expect(nameMatchCandidate('Λονδίνο', NODES)).toBeNull();
  });
  it('returns null for too-short queries', () => {
    expect(nameMatchCandidate('Αθ', NODES)).toBeNull();
  });
});

describe('haversineKm / nearestNode', () => {
  it('computes a sane distance', () => {
    const d = haversineKm({ lat: 37.9838, lng: 23.7275 }, { lat: 40.6401, lng: 22.9444 });
    expect(d).toBeGreaterThan(280);
    expect(d).toBeLessThan(320);
  });
  it('finds the nearest node within the cap', () => {
    expect(nearestNode({ lat: 37.99, lng: 23.73 }, NODES, 50)).toBe('0511');
  });
  it('returns null when nothing is within the cap', () => {
    expect(nearestNode({ lat: 0, lng: 0 }, NODES, 50)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- match`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `lib/regions/match.ts`**

```ts
import { prisma } from '@/lib/db';
import { geocodeAddress } from '@/lib/geocode';
import { deriveHierarchy, type RegionBreadcrumb } from '@/lib/regions/tree';

const MIN_QUERY_LEN = 4;   // avoid false positives on tiny strings
const STEM_LEN = 5;        // shared-prefix length for genitive/nominative matching
const GEO_CAP_KM = 50;     // reject geo matches farther than this from any Δήμος centroid

// Administrative prefixes stripped from both Καλλικράτης names and ΓΕΜΗ official names
const ADMIN_PREFIX = /^\s*(ΔΗΜΟΣ|Δ\.|ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ|ΠΕΡΙΦΕΡΕΙΑ|ΝΟΜΟΣ|Π\.Ε\.)\s+/;

export type RegionMatch = {
  regionCode: string;
  breadcrumb: RegionBreadcrumb;
  confidence: 'gemi' | 'name' | 'geo';
};

type MatchInput = {
  address?: string | null;
  city?: string | null;
  district?: string | null;
  zip?: string | null;
  country?: string | null;
  municipalityId?: string | null;   // ΓΕΜΗ Municipality.id
  prefectureId?: string | null;     // ΓΕΜΗ Prefecture.id
  latitude?: number | null;
  longitude?: number | null;
};

type Level5Node = { code: string; nameEL: string; latitude: number | null; longitude: number | null };

/** Uppercase, strip diacritics, normalize final sigma, collapse whitespace. */
export function normalizeGreek(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // combining accents
    .replace(/ς/g, 'σ')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip admin prefixes (ΔΗΜΟΣ/ΝΟΜΟΣ/ΠΕΡΙΦΕΡΕΙΑΚΗ ΕΝΟΤΗΤΑ/…) + parentheticals, then normalize. */
export function coreName(nameEL: string): string {
  const noParen = nameEL.replace(/\(.*?\)/g, '').trim();
  const norm = normalizeGreek(noParen);
  return norm.replace(ADMIN_PREFIX, '').trim();
}

/** Best level-5 code for a free-text place name, or null. */
export function nameMatchCandidate(
  query: string,
  nodes: { code: string; nameEL: string }[],
): string | null {
  const q = normalizeGreek(query);
  if (q.length < MIN_QUERY_LEN) return null;

  // 1) exact normalized core match
  for (const n of nodes) if (coreName(n.nameEL) === q) return n.code;
  // 2) containment either direction (handles "ΑΘΗΝΑ" ⊂ "ΑΘΗΝΑΙΩΝ", "ΔΟΞΑΤΟ" ⊂ "ΔΟΞΑΤΟΥ")
  for (const n of nodes) {
    const core = coreName(n.nameEL);
    if (core.includes(q) || q.includes(core)) return n.code;
  }
  // 3) shared stem (first STEM_LEN chars)
  if (q.length >= STEM_LEN) {
    const stem = q.slice(0, STEM_LEN);
    for (const n of nodes) if (coreName(n.nameEL).startsWith(stem)) return n.code;
  }
  return null;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestNode(
  point: { lat: number; lng: number },
  nodes: { code: string; latitude: number | null; longitude: number | null }[],
  capKm = GEO_CAP_KM,
): string | null {
  let best: string | null = null;
  let bestKm = Infinity;
  for (const n of nodes) {
    if (n.latitude == null || n.longitude == null) continue;
    const km = haversineKm(point, { lat: n.latitude, lng: n.longitude });
    if (km < bestKm) { bestKm = km; best = n.code; }
  }
  return bestKm <= capKm ? best : null;
}

/** Hybrid: ΓΕΜΗ official names → free-text name match → geocode-nearest fallback. */
export async function matchRegion(input: MatchInput): Promise<RegionMatch | null> {
  const nodes: Level5Node[] = await prisma.region.findMany({
    where: { level: 5 },
    select: { code: true, nameEL: true, latitude: true, longitude: true },
  });

  // 0) ΓΕΜΗ Δήμος (highest signal) — official Municipality.descr → level-5
  if (input.municipalityId) {
    const muni = await prisma.municipality.findUnique({
      where: { id: input.municipalityId }, select: { descr: true },
    });
    if (muni?.descr) {
      const code = nameMatchCandidate(muni.descr, nodes);
      if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'gemi' };
    }
  }

  // 0b) ΓΕΜΗ Νομός/Π.Ε. — official Prefecture.descr → level-4 (Δήμος stays "—")
  if (input.prefectureId) {
    const pref = await prisma.prefecture.findUnique({
      where: { id: input.prefectureId }, select: { descr: true },
    });
    if (pref?.descr) {
      const units = await prisma.region.findMany({
        where: { level: 4 }, select: { code: true, nameEL: true },
      });
      const code = nameMatchCandidate(pref.descr, units);
      if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'gemi' };
    }
  }

  // 1) free-text name match — district first (more specific), then city
  for (const q of [input.district, input.city]) {
    if (!q) continue;
    const code = nameMatchCandidate(q, nodes);
    if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'name' };
  }

  // 2) geo fallback — use given coords, else geocode the address
  let point: { lat: number; lng: number } | null =
    input.latitude != null && input.longitude != null
      ? { lat: input.latitude, lng: input.longitude }
      : null;
  if (!point) {
    const geo = await geocodeAddress({
      address: input.address ?? null, city: input.city ?? null,
      zip: input.zip ?? null, country: input.country ?? 'GR',
    });
    if (geo) point = { lat: geo.lat, lng: geo.lng };
  }
  if (point) {
    const code = nearestNode(point, nodes);
    if (code) return { regionCode: code, breadcrumb: await deriveHierarchy(code), confidence: 'geo' };
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- match`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/regions/match.ts lib/regions/__tests__/match.test.ts
git commit -m "feat(regions): hybrid address→Δήμος matcher with unit tests"
```

---

## Task 5: `lib/regions/decoder.ts`

**Files:**
- Create: `lib/regions/decoder.ts`

- [ ] **Step 1: Implement the decoder (mirrors lib/kad/decoder.ts)**

```ts
import { prisma } from '@/lib/db';
import { deriveHierarchy, type RegionBreadcrumb } from '@/lib/regions/tree';

export type DecodedRegion = {
  code: string;
  nameEL: string;
  nameEN: string | null;
  level: number;
  path: string | null;
  latitude: number | null;
  longitude: number | null;
  breadcrumb: RegionBreadcrumb;
  children: Array<{ code: string; nameEL: string; level: number }>;
};

/** Look up a region by exact code, or by case-insensitive nameEL contains. */
export async function decodeRegion(input: string): Promise<DecodedRegion | null> {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  let hit = await prisma.region.findUnique({ where: { code: raw } });
  if (!hit) {
    hit = await prisma.region.findFirst({
      where: { nameEL: { contains: raw } },
      orderBy: [{ level: 'asc' }, { code: 'asc' }],
    });
  }
  if (!hit) return null;

  const [children, breadcrumb] = await Promise.all([
    prisma.region.findMany({
      where: { parentCode: hit.code },
      orderBy: { nameEL: 'asc' },
      take: 400,
      select: { code: true, nameEL: true, level: true },
    }),
    deriveHierarchy(hit.code),
  ]);

  return {
    code: hit.code, nameEL: hit.nameEL, nameEN: hit.nameEN, level: hit.level,
    path: hit.path, latitude: hit.latitude, longitude: hit.longitude,
    breadcrumb, children,
  };
}
```

- [ ] **Step 2: Sanity check via tsx**

Run: `npx tsx -e "import {decodeRegion} from './lib/regions/decoder'; import {prisma} from './lib/db'; (async()=>{console.log(JSON.stringify(await decodeRegion('Δράμας'),null,2)); await prisma.\$disconnect();})()"`
Expected: a region node (the Δράμα Π.Ε. or Δήμος) with a populated `breadcrumb` and `children`.

- [ ] **Step 3: Commit**

```bash
git add lib/regions/decoder.ts
git commit -m "feat(regions): region decoder for browser page"
```

---

## Task 6: API routes

**Files:**
- Create: `app/api/regions/children/route.ts`, `app/api/regions/decode/route.ts`, `app/api/regions/match/route.ts`

- [ ] **Step 1: `children` route (mirrors /api/kad/children)**

Create `app/api/regions/children/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';

// GET /api/regions/children            → top-level (Περιφέρειες, level=3)
// GET /api/regions/children?parent=111 → direct children of "111"
export async function GET(request: NextRequest) {
  await requirePermission('metadata.read');
  const parent = request.nextUrl.searchParams.get('parent');

  const rows = await prisma.region.findMany({
    where: parent ? { parentCode: parent } : { level: 3 },
    orderBy: { nameEL: 'asc' },
    select: {
      code: true, nameEL: true, level: true, parentCode: true, path: true,
      _count: { select: { children: true } },
    },
  });

  const descendants = await Promise.all(
    rows.map((r) =>
      r.path ? prisma.region.count({ where: { path: { startsWith: `${r.path}>` } } }) : Promise.resolve(0),
    ),
  );

  return NextResponse.json({
    nodes: rows.map((r, i) => ({
      code: r.code,
      nameEL: r.nameEL,
      level: r.level,
      parentCode: r.parentCode,
      directChildren: r._count.children,
      descendants: descendants[i],
      hasChildren: r._count.children > 0,
    })),
  });
}
```

- [ ] **Step 2: `decode` route (mirrors /api/kad/decode)**

Create `app/api/regions/decode/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { decodeRegion } from '@/lib/regions/decoder';
import { requirePermission } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  await requirePermission('metadata.read');
  const { code } = await request.json().catch(() => ({ code: '' }));
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'invalid', message: 'Εισάγετε κωδικό ή όνομα περιοχής' }, { status: 400 });
  }
  const result = await decodeRegion(code);
  if (!result) {
    return NextResponse.json({ error: 'not_found', message: `Η περιοχή "${code}" δεν βρέθηκε` }, { status: 404 });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 3: `match` route**

Create `app/api/regions/match/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { matchRegion } from '@/lib/regions/match';
import { requirePermission } from '@/lib/rbac';

export async function POST(request: NextRequest) {
  await requirePermission('companies.read');
  const body = await request.json().catch(() => ({}));
  const result = await matchRegion({
    address: body.address ?? null,
    city: body.city ?? null,
    district: body.district ?? null,
    zip: body.zip ?? null,
    country: body.country ?? null,
    municipalityId: body.municipalityId ?? null,
    prefectureId: body.prefectureId ?? null,
    latitude: typeof body.latitude === 'number' ? body.latitude : null,
    longitude: typeof body.longitude === 'number' ? body.longitude : null,
  });
  if (!result) {
    return NextResponse.json({ error: 'not_found', message: 'Δεν βρέθηκε αντιστοίχιση' }, { status: 404 });
  }
  return NextResponse.json(result);
}
```

- [ ] **Step 4: Verify the routes compile**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `app/api/regions/**`.

- [ ] **Step 5: Commit**

```bash
git add app/api/regions
git commit -m "feat(regions): children/decode/match API routes"
```

---

## Task 7: UI components — tree, decoder, picker, field

**Files:**
- Create: `components/regions/region-tree.tsx`, `components/regions/region-decoder.tsx`, `components/regions/region-picker.tsx`, `components/regions/region-field.tsx`

- [ ] **Step 1: `region-tree.tsx` (clone of kad-tree, level labels for Καλλικράτης)**

```tsx
'use client';

import * as React from 'react';
import { FiChevronRight, FiChevronDown, FiLoader } from 'react-icons/fi';

export type RegionTreeNodeData = {
  code: string;
  nameEL: string;
  level: number | null;
  parentCode: string | null;
  directChildren: number;
  descendants: number;
  hasChildren: boolean;
};

const levelLabels: Record<number, string> = {
  3: 'Περιφέρεια', 4: 'Περιφ. Ενότητα / Νομός', 5: 'Δήμος',
};

function levelStyles(level: number | null) {
  if (level === 3) return { border: 'border-blue-300', badge: 'bg-blue-100 text-blue-800 border-blue-200' };
  if (level === 4) return { border: 'border-emerald-300', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  if (level === 5) return { border: 'border-purple-300', badge: 'bg-purple-100 text-purple-800 border-purple-200' };
  return { border: 'border-slate-300', badge: 'bg-slate-100 text-slate-700 border-slate-200' };
}

export function RegionTree({
  initialRoots,
  onPick,
}: {
  initialRoots: RegionTreeNodeData[];
  onPick?: (node: RegionTreeNodeData) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {initialRoots.map((r) => <RegionNode key={r.code} node={r} depth={0} onPick={onPick} />)}
    </ul>
  );
}

function RegionNode({
  node, depth, onPick,
}: { node: RegionTreeNodeData; depth: number; onPick?: (n: RegionTreeNodeData) => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [children, setChildren] = React.useState<RegionTreeNodeData[] | null>(null);
  const styles = levelStyles(node.level);

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.hasChildren) return;
    if (!expanded && !children) {
      setLoading(true);
      try {
        const res = await fetch(`/api/regions/children?parent=${encodeURIComponent(node.code)}`);
        const data = await res.json();
        setChildren(data.nodes ?? []);
      } finally { setLoading(false); }
    }
    setExpanded((v) => !v);
  };

  return (
    <li>
      <div className={`group flex items-center gap-2 rounded-lg border-2 ${styles.border} bg-white px-2.5 py-1.5 hover:shadow-sm transition-shadow ${onPick ? 'cursor-pointer' : ''}`}
           onClick={onPick ? () => onPick(node) : undefined}>
        <button type="button" onClick={toggle}
                aria-label={node.hasChildren ? (expanded ? 'collapse' : 'expand') : 'leaf'}
                className="w-5 h-5 flex items-center justify-center text-slate-500 disabled:opacity-30"
                disabled={!node.hasChildren}>
          {loading ? <FiLoader className="animate-spin" /> :
            node.hasChildren ? (expanded ? <FiChevronDown /> : <FiChevronRight />) : <span className="w-2 h-2" />}
        </button>

        <span className="font-mono text-[11px] tabular-nums text-slate-500 w-24 shrink-0">{node.code}</span>
        <span className="text-[11px] font-medium uppercase truncate text-slate-700">{node.nameEL}</span>

        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          {node.level != null && (
            <span className={`px-2 py-0.5 rounded text-[11px] font-medium border ${styles.badge}`}>
              {levelLabels[node.level] ?? `L${node.level}`}
            </span>
          )}
          {node.descendants > 0 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800 border border-amber-200">
              {node.descendants.toLocaleString('el-GR')}
            </span>
          )}
        </div>
      </div>

      {expanded && children && children.length > 0 && (
        <ul className="space-y-1.5 mt-1.5" style={{ paddingLeft: `${(depth + 1) * 20}px` }}>
          {children.map((c) => <RegionNode key={c.code} node={c} depth={depth + 1} onPick={onPick} />)}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 2: `region-decoder.tsx` (clone of kad-decoder, region shape)**

```tsx
'use client';

import * as React from 'react';
import { FiCheck, FiX, FiChevronRight, FiSearch } from 'react-icons/fi';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type Breadcrumb = {
  region: { code: string; nameEL: string } | null;
  regionalUnit: { code: string; nameEL: string } | null;
  municipality: { code: string; nameEL: string } | null;
};
type Decoded = {
  code: string; nameEL: string; level: number;
  breadcrumb: Breadcrumb;
  children: Array<{ code: string; nameEL: string; level: number }>;
};

const levelLabels: Record<number, string> = { 3: 'Περιφέρεια', 4: 'Περιφ. Ενότητα / Νομός', 5: 'Δήμος' };

export function RegionDecoder() {
  const [input, setInput] = React.useState('');
  const [result, setResult] = React.useState<Decoded | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const decode = React.useCallback(async () => {
    if (!input.trim()) { setError('Εισάγετε κωδικό ή όνομα'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/regions/decode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: input.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Σφάλμα'); setResult(null); return; }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Άγνωστο σφάλμα'); setResult(null);
    } finally { setLoading(false); }
  }, [input]);

  const chain = result
    ? [result.breadcrumb.region, result.breadcrumb.regionalUnit, result.breadcrumb.municipality].filter(Boolean) as { code: string; nameEL: string }[]
    : [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex gap-2">
          <Input placeholder="π.χ. 1110202 ή «Δοξάτου»" value={input}
                 onChange={(e) => setInput(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') decode(); }} disabled={loading} />
          <Button onClick={decode} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FiSearch />} Αναζήτηση
          </Button>
        </div>
        {error && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 flex gap-2">
            <FiX className="mt-0.5" /> {error}
          </div>
        )}
      </Card>

      {result && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2 border-b pb-3">
            <FiCheck className="text-emerald-600" />
            <span className="text-xl font-bold font-mono">{result.code}</span>
            <span className="text-sm text-muted-foreground">{result.nameEL}</span>
            <Badge variant="outline" className="ml-auto">{levelLabels[result.level] ?? `L${result.level}`}</Badge>
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-2">Ιεραρχία Καλλικράτη</h3>
            <ol className="space-y-1">
              {chain.map((it) => (
                <li key={it.code} className="flex items-start gap-2 text-sm">
                  <span className="font-mono text-xs w-24 text-muted-foreground">{it.code}</span>
                  <FiChevronRight className="mt-1 text-muted-foreground" />
                  <span className="flex-1">{it.nameEL}</span>
                </li>
              ))}
            </ol>
          </div>
          {result.children.length > 0 && (
            <div>
              <h3 className="font-semibold text-sm mb-2">Υποδιαιρέσεις ({result.children.length})</h3>
              <ul className="space-y-1 max-h-60 overflow-auto">
                {result.children.map((c) => (
                  <li key={c.code} className="flex gap-2 text-sm">
                    <span className="font-mono text-xs w-24 text-muted-foreground">{c.code}</span>
                    <span>{c.nameEL}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `region-picker.tsx` (modal tree picker)**

```tsx
'use client';

import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RegionTree, type RegionTreeNodeData } from '@/components/regions/region-tree';

export function RegionPicker({
  open, onOpenChange, onSelect,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (code: string, nameEL: string) => void;
}) {
  const [roots, setRoots] = React.useState<RegionTreeNodeData[] | null>(null);

  React.useEffect(() => {
    if (open && !roots) {
      fetch('/api/regions/children').then((r) => r.json()).then((d) => setRoots(d.nodes ?? []));
    }
  }, [open, roots]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
        <DialogHeader><DialogTitle>Επιλογή Δήμου / Περιοχής</DialogTitle></DialogHeader>
        {roots == null ? (
          <div className="text-sm text-muted-foreground p-4 text-center">Φόρτωση…</div>
        ) : (
          <RegionTree
            initialRoots={roots}
            onPick={(n) => { onSelect(n.code, n.nameEL); onOpenChange(false); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: `region-field.tsx` (breadcrumb + detect + picker — reused by the company form)**

```tsx
'use client';

import * as React from 'react';
import { FiMapPin, FiSearch, FiX } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { RegionPicker } from '@/components/regions/region-picker';

type Breadcrumb = {
  region: { code: string; nameEL: string } | null;
  regionalUnit: { code: string; nameEL: string } | null;
  municipality: { code: string; nameEL: string } | null;
};

export type RegionFieldValue = { regionCode: string | null; breadcrumb: Breadcrumb | null };

export function RegionField({
  value,
  address,
  onChange,
}: {
  value: RegionFieldValue;
  address: { address?: string | null; city?: string | null; district?: string | null; zip?: string | null; country?: string | null; municipalityId?: string | null; prefectureId?: string | null; latitude?: number | null; longitude?: number | null };
  onChange: (v: RegionFieldValue) => void;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [detecting, setDetecting] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const detect = async () => {
    setDetecting(true); setMsg(null);
    try {
      const res = await fetch('/api/regions/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(address),
      });
      if (!res.ok) { setMsg('Δεν βρέθηκε αντιστοίχιση — επιλέξτε χειροκίνητα'); return; }
      const data = await res.json();
      onChange({ regionCode: data.regionCode, breadcrumb: data.breadcrumb });
      setMsg(data.confidence === 'name' ? 'Εντοπίστηκε από όνομα' : 'Εντοπίστηκε από συντεταγμένες');
    } finally { setDetecting(false); }
  };

  const pickManually = async (code: string) => {
    const res = await fetch('/api/regions/decode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    });
    const data = await res.json();
    onChange({ regionCode: code, breadcrumb: data.breadcrumb ?? null });
  };

  const b = value.breadcrumb;
  const chain = b ? [b.region?.nameEL, b.regionalUnit?.nameEL, b.municipality?.nameEL].filter(Boolean) : [];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-h-9 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
          {chain.length ? chain.join(' › ') : <span className="text-muted-foreground">— καμία αντιστοίχιση —</span>}
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={detect} disabled={detecting}>
          <FiMapPin className="w-4 h-4" /> {detecting ? 'Εντοπισμός…' : 'Εντοπισμός'}
        </Button>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setPickerOpen(true)}>
          <FiSearch className="w-4 h-4" /> Επιλογή
        </Button>
        {value.regionCode && (
          <Button type="button" variant="ghost" size="sm" aria-label="clear"
                  onClick={() => onChange({ regionCode: null, breadcrumb: null })}>
            <FiX className="w-4 h-4" />
          </Button>
        )}
      </div>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      <RegionPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={(code) => pickManually(code)} />
    </div>
  );
}
```

- [ ] **Step 5: Verify components typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `components/regions/**`. (If `@/components/ui/dialog` exports differ, adjust imports to match the project's dialog API — check `components/ui/dialog.tsx`.)

- [ ] **Step 6: Commit**

```bash
git add components/regions
git commit -m "feat(regions): tree, decoder, picker, and reusable region field components"
```

---

## Task 8: Admin browser page + sidebar link

**Files:**
- Create: `app/admin/regions/page.tsx`
- Modify: `components/admin/sidebar.tsx`

- [ ] **Step 1: Create the page (mirrors app/admin/kad-codes/page.tsx)**

```tsx
import { FiMapPin } from 'react-icons/fi';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { PageHeader } from '@/components/admin/page-header';
import { Card } from '@/components/ui/card';
import { RegionDecoder } from '@/components/regions/region-decoder';
import { RegionTree } from '@/components/regions/region-tree';

export const dynamic = 'force-dynamic';

export default async function RegionsPage() {
  await requirePermission('metadata.read');

  const [roots, total] = await Promise.all([
    prisma.region.findMany({
      where: { level: 3 },
      orderBy: { nameEL: 'asc' },
      select: {
        code: true, nameEL: true, level: true, parentCode: true, path: true,
        _count: { select: { children: true } },
      },
    }),
    prisma.region.count(),
  ]);

  const descendants = await Promise.all(
    roots.map((r) =>
      r.path ? prisma.region.count({ where: { path: { startsWith: `${r.path}>` } } }) : Promise.resolve(0),
    ),
  );

  const initialRoots = roots.map((r, i) => ({
    code: r.code,
    nameEL: r.nameEL,
    level: r.level,
    parentCode: r.parentCode,
    directChildren: r._count.children,
    descendants: descendants[i],
    hasChildren: r._count.children > 0,
  }));

  return (
    <div className="w-full space-y-6">
      <PageHeader
        icon={<FiMapPin />}
        title="Μητρώο Περιφερειών"
        helpAnchor="perifereies"
        description={`Δενδροειδής δομή Καλλικράτη — Περιφέρεια › Περιφερειακή Ενότητα/Νομός › Δήμος (${total.toLocaleString('el-GR')} εγγραφές)`}
      />

      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Αναζήτηση περιοχής</h2>
        <RegionDecoder />
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground">Ιεραρχικό δέντρο</h2>
        <Card className="p-3">
          {initialRoots.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">
              Δεν υπάρχουν δεδομένα. Εκτελέστε:{' '}
              <code className="bg-muted px-2 py-0.5 rounded">npm run seed:regions</code>
            </div>
          ) : (
            <RegionTree initialRoots={initialRoots} />
          )}
        </Card>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Add the sidebar link**

In `components/admin/sidebar.tsx`, first ensure `FiMapPin` is imported in the existing `react-icons/fi` import list at the top. Then in the `'Δεδομένα'` group, add immediately after the `kad-codes` line (line 49):

```tsx
      { href: '/admin/regions', label: 'Μητρώο Περιφερειών', icon: FiMapPin, permissions: ['metadata.read'] },
```

- [ ] **Step 3: Verify in the running app**

Run the dev server (`npm run dev`), log in, open `/admin/regions`.
Expected: 14 Περιφέρειες render as a tree; expanding a Περιφέρεια lazy-loads its Π.Ε.; expanding a Π.Ε. lazy-loads Δήμοι. The "Μητρώο Περιφερειών" link appears in the sidebar «Δεδομένα» group. The decoder finds "Δοξάτου".

- [ ] **Step 4: Commit**

```bash
git add app/admin/regions/page.tsx components/admin/sidebar.tsx
git commit -m "feat(regions): /admin/regions browser page + sidebar link"
```

---

## Task 9: Auto-fill `regionCode` in company & branch APIs

**Files:**
- Modify: `app/api/admin/companies/route.ts`
- Modify: `app/api/admin/companies/[id]/route.ts`
- Modify: `app/api/admin/companies/[id]/branches/route.ts`
- Modify: `app/api/admin/companies/[id]/branches/[branchId]/route.ts`

- [ ] **Step 1: Company POST — schema field + auto-fill**

In `app/api/admin/companies/route.ts`:

1. Add the import near the other lib imports:
```ts
import { matchRegion } from '@/lib/regions/match';
```
2. In `CompanyBaseSchema`, next to `municipalityId`, add:
```ts
  regionCode: z.string().optional().nullable(),
```
3. In `POST`, replace the `company` creation block so `regionCode` is auto-filled when missing. After the existing `const geo = await geocodeAddress(...)` line, add:
```ts
  let regionCode = rest.regionCode ?? null;
  if (!regionCode && (rest.municipalityId || rest.prefectureId || rest.address || rest.city || rest.district)) {
    const m = await matchRegion({
      address: rest.address, city: rest.city, district: rest.district, zip: rest.zip, country: rest.country,
      municipalityId: rest.municipalityId, prefectureId: rest.prefectureId,
      latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
    });
    if (m) regionCode = m.regionCode;
  }
```
Then in the `prisma.company.create({ data: { ...rest, ... } })` call, ensure `regionCode` reflects the computed value by adding after `...rest,`:
```ts
      regionCode,
```

- [ ] **Step 2: Company PATCH — schema field + auto-fill**

In `app/api/admin/companies/[id]/route.ts`:

1. Add import:
```ts
import { matchRegion } from '@/lib/regions/match';
```
2. In `UpdateSchema`, next to `municipalityId`, add:
```ts
  regionCode: z.string().optional().nullable(),
```
3. Inside `PATCH`, after the `geo` computation and before `const company = await prisma.$transaction(...)`, add auto-fill that runs only when the address changed and the client did not explicitly set `regionCode`:
```ts
  if (!('regionCode' in rest) && addrChanged) {
    const cur = await prisma.company.findUnique({
      where: { id }, select: { regionCode: true, address: true, city: true, district: true, zip: true, country: true, municipalityId: true, prefectureId: true },
    });
    if (!cur?.regionCode) {
      const m = await matchRegion({
        address: rest.address ?? cur?.address, city: rest.city ?? cur?.city,
        district: rest.district ?? cur?.district, zip: rest.zip ?? cur?.zip, country: rest.country ?? cur?.country,
        municipalityId: rest.municipalityId ?? cur?.municipalityId, prefectureId: rest.prefectureId ?? cur?.prefectureId,
        latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
      });
      if (m) (rest as any).regionCode = m.regionCode;
    }
  }
```
Note: the PATCH auto-fill should also run when the client did not change the address but the GEMI ids changed — broaden the guard to `addrChanged || 'municipalityId' in rest || 'prefectureId' in rest`.
(`regionCode` is already part of `...rest` spread into `tx.company.update`, so no further change to the update call is needed.)

- [ ] **Step 3: Branch POST — schema field + auto-fill**

In `app/api/admin/companies/[id]/branches/route.ts`:

1. Add import:
```ts
import { matchRegion } from '@/lib/regions/match';
```
2. In `BranchSchema`, add:
```ts
  regionCode: z.string().optional().nullable(),
```
3. In `POST`, after `const geo = await geocodeAddress(...)`, add:
```ts
  let regionCode = rest.regionCode ?? null;
  if (!regionCode && (rest.address || rest.city || rest.district)) {
    const m = await matchRegion({
      address: rest.address, city: rest.city, district: rest.district, zip: rest.zip, country: rest.country,
      latitude: geo?.lat ?? null, longitude: geo?.lng ?? null,
    });
    if (m) regionCode = m.regionCode;
  }
```
Then in `tx.companyBranch.create({ data: { ...rest, ... } })`, add after `...rest,`:
```ts
        regionCode,
```

- [ ] **Step 4: Branch PATCH — mirror the company PATCH pattern**

Open `app/api/admin/companies/[id]/branches/[branchId]/route.ts`. Add `import { matchRegion } from '@/lib/regions/match';`, add `regionCode: z.string().optional().nullable(),` to its update schema, and replicate the Step 2 auto-fill pattern (read current branch `regionCode`/address, fill only when address changed and `regionCode` not explicitly provided and currently empty). Use the same field names as the existing branch update handler in that file.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors.

- [ ] **Step 6: Runtime verification**

With the dev server up, create a company via the API/UI with `city: "Δοξάτο"` and no `regionCode`.
Run: `npx tsx -e "import {prisma} from './lib/db'; (async()=>{const c=await prisma.company.findFirst({orderBy:{createdAt:'desc'},select:{name:true,city:true,regionCode:true}}); console.log(c); await prisma.\$disconnect();})()"`
Expected: `regionCode: '1110202'` (ΔΗΜΟΣ ΔΟΞΑΤΟΥ).

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/companies
git commit -m "feat(regions): auto-fill regionCode on company & branch create/update"
```

---

## Task 10: Company UI — region field in form + actions-dropdown detect

**Files:**
- Modify: `app/admin/companies/companies-view.tsx`
- Modify: `app/admin/companies/page.tsx`

> Note: `companies-view.tsx` is large. Make targeted edits only at the anchors below; do not restructure the file.

- [ ] **Step 1: Pass `regionCode` from the server page to the client view**

In `app/admin/companies/page.tsx`, the company row mapping (around line 70-72) already maps `prefectureId`/`municipalityId`. Add `regionCode`:
```ts
    regionCode: c.regionCode,
```
Ensure the underlying `prisma.company.findMany` select/`include` returns `regionCode` (if it uses a full-model fetch, it already does; if it uses an explicit `select`, add `regionCode: true`).

- [ ] **Step 2: Extend the client company type + form state**

In `companies-view.tsx`, near the existing `municipalityId: string | null;` (line ~77) in the company type, add:
```ts
  regionCode: string | null;
```
In the form-state initializer where `municipalityId: c.municipalityId ?? ''` is set (line ~487), add:
```ts
            regionCode: c.regionCode ?? null,
```
Add a local breadcrumb state near the dialog's other `useState`s:
```ts
  const [regionBreadcrumb, setRegionBreadcrumb] = React.useState<import('@/components/regions/region-field').RegionFieldValue['breadcrumb']>(null);
```

- [ ] **Step 3: Import and render `RegionField` in the Contact tab**

Add the import at the top of `companies-view.tsx`:
```ts
import { RegionField } from '@/components/regions/region-field';
```
In the Contact tab, right after the address/city/zip fields (around line 789-791), add a full-width field:
```tsx
<Field label="Περιφέρεια / Νομός / Δήμος (Καλλικράτης)" id="c-region" wide>
  <RegionField
    value={{ regionCode: form.regionCode ?? null, breadcrumb: regionBreadcrumb }}
    address={{ address: form.address, city: form.city, district: form.district, zip: form.zip, country: form.country, municipalityId: form.municipalityId || null, prefectureId: form.prefectureId || null, latitude: null, longitude: null }}
    onChange={(v) => { set('regionCode', v.regionCode); setRegionBreadcrumb(v.breadcrumb); }}
  />
</Field>
```
(If the editing company already has a `regionCode`, fetch its breadcrumb once on dialog open via `/api/regions/decode` to seed `regionBreadcrumb`.)

- [ ] **Step 4: Send `regionCode` on save**

In the `save` payload builder (around line 544-545 where `prefectureId`/`municipalityId` are added), add:
```ts
      regionCode: form.regionCode || null,
```

- [ ] **Step 5: Add the "Εντοπισμός Περιφέρειας/Νομού/Δήμου" actions-dropdown item**

In the per-row actions dropdown (lines 313-332), add a new item after the "Επαφή" item and before the separator. It calls the match API for the row, then PATCHes the company so all three levels persist:
```tsx
              <DropdownMenuItem onClick={async () => {
                const res = await fetch('/api/regions/match', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ address: c.address, city: c.city, district: c.district, zip: c.zip, country: c.country, municipalityId: c.municipalityId, prefectureId: c.prefectureId }),
                });
                if (!res.ok) { alert('Δεν βρέθηκε αντιστοίχιση Καλλικράτη'); return; }
                const m = await res.json();
                await fetch(`/api/admin/companies/${c.id}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ regionCode: m.regionCode }),
                });
                const chain = [m.breadcrumb.region?.nameEL, m.breadcrumb.regionalUnit?.nameEL, m.breadcrumb.municipality?.nameEL].filter(Boolean).join(' › ');
                alert(`Αντιστοιχίστηκε: ${chain}`);
                router.refresh();
              }}>
                <FiMapPin className="mr-2 h-4 w-4" /> Εντοπισμός Περιφέρειας/Νομού/Δήμου
              </DropdownMenuItem>
```
Ensure `FiMapPin` is added to the `react-icons/fi` import at the top of the file, and that a `router` (`useRouter()` from `next/navigation`) is available in scope (add it if not already present).

- [ ] **Step 6: Typecheck + manual verification**

Run: `npx tsc --noEmit -p tsconfig.json` → no new errors.
With the dev server up: open a company, go to the Contact tab, click «Εντοπισμός» → breadcrumb fills; click «Επιλογή» → picker opens, choose a Δήμος → breadcrumb updates; save → reopen → value persists. In the list, the actions-dropdown «Εντοπισμός Περιφέρειας/Νομού/Δήμου» runs and shows the chain.

- [ ] **Step 7: Commit**

```bash
git add app/admin/companies/companies-view.tsx app/admin/companies/page.tsx
git commit -m "feat(regions): region field in company form + actions-dropdown detect"
```

---

## Task 11: Wiki entry (CLAUDE.md requirement)

**Files:**
- Modify: `lib/wiki/modules-meta.ts`, `lib/wiki/types.ts`
- Create: `docs/wiki/mitroa/perifereies.mdx` (via script)

- [ ] **Step 1: Register the `mitroa` module**

In `lib/wiki/modules-meta.ts`, add an entry (ensure `FiMapPin` is imported there):
```ts
  mitroa: {
    label: 'Μητρώο Περιφερειών', description: 'Δομή Καλλικράτη — Περιφέρειες/Νομοί/Δήμοι',
    icon: FiMapPin,
    gradientFrom: '#38bdf8', gradientTo: '#0284c7',
    accent: '#0369a1', accentSoft: '#e0f2fe',
  },
```
In `lib/wiki/types.ts`, add to the module-title map:
```ts
  mitroa: 'Μητρώο Περιφερειών',
```

- [ ] **Step 2: Scaffold the wiki page**

Run: `npm run wiki:new -- mitroa/perifereies --roles "ADMIN,EMPLOYEE" --title "Περιφέρειες (Καλλικράτης)"`
Expected: `docs/wiki/mitroa/perifereies.mdx` created.

- [ ] **Step 3: Write the content (Greek)**

Replace the body of `docs/wiki/mitroa/perifereies.mdx` with frontmatter `helpAnchors: [perifereies]`, a `description`, and content:
- Επισκόπηση: τι είναι το μητρώο Περιφερειών (δομή Καλλικράτη, read-only, seed).
- `<Steps>`: (1) Άνοιγμα `/admin/regions`, (2) αναζήτηση/περιήγηση δέντρου, (3) στην καρτέλα εταιρίας «Εντοπισμός» ή «Επιλογή», (4) actions-dropdown «Εντοπισμός Περιφέρειας/Νομού/Δήμου».
- `<Callout type="info">`: η αυτόματη συμπλήρωση τρέχει στη δημιουργία/ενημέρωση όταν `regionCode` είναι κενό· πρώτα ταίριασμα ονόματος, μετά geocoding.
- `screenshots:` frontmatter with `route: /admin/regions`.

- [ ] **Step 4: Rebuild the search index**

Run: `npm run wiki:index`
Expected: `public/wiki/index.json` updated.

- [ ] **Step 5: Commit**

```bash
git add lib/wiki/modules-meta.ts lib/wiki/types.ts docs/wiki/mitroa/perifereies.mdx public/wiki/index.json
git commit -m "docs(wiki): Περιφέρειες (Καλλικράτης) module + page"
```

---

## Task 12: One-time backfill of `regionCode` for existing companies & branches

**Files:**
- Create: `scripts/backfill-regions.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the backfill script**

Create `scripts/backfill-regions.ts`:

```ts
import 'dotenv/config';
import { prisma } from '../lib/db';
import { matchRegion } from '../lib/regions/match';

async function main() {
  const companies = await prisma.company.findMany({
    where: { regionCode: null },
    select: {
      id: true, name: true, address: true, city: true, district: true, zip: true, country: true,
      municipalityId: true, prefectureId: true, latitude: true, longitude: true,
    },
  });
  console.log(`Companies to backfill: ${companies.length}`);

  const tally: Record<string, number> = { gemi: 0, name: 0, geo: 0, none: 0 };
  for (const c of companies) {
    const m = await matchRegion({
      address: c.address, city: c.city, district: c.district, zip: c.zip, country: c.country,
      municipalityId: c.municipalityId, prefectureId: c.prefectureId,
      latitude: c.latitude, longitude: c.longitude,
    });
    if (m) {
      await prisma.company.update({ where: { id: c.id }, data: { regionCode: m.regionCode } });
      tally[m.confidence]++;
    } else {
      tally.none++;
    }
  }
  console.log('Companies:', tally);

  const branches = await prisma.companyBranch.findMany({
    where: { regionCode: null },
    select: {
      id: true, address: true, city: true, district: true, zip: true, country: true,
      latitude: true, longitude: true,
    },
  });
  console.log(`Branches to backfill: ${branches.length}`);

  const btally: Record<string, number> = { name: 0, geo: 0, none: 0 };
  for (const b of branches) {
    const m = await matchRegion({
      address: b.address, city: b.city, district: b.district, zip: b.zip, country: b.country,
      latitude: b.latitude, longitude: b.longitude,
    });
    if (m) {
      await prisma.companyBranch.update({ where: { id: b.id }, data: { regionCode: m.regionCode } });
      btally[m.confidence]++;
    } else {
      btally.none++;
    }
  }
  console.log('Branches:', btally);
  console.log('Backfill done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add the npm script**

In `package.json` `"scripts"`, add:

```json
    "backfill:regions": "tsx scripts/backfill-regions.ts",
```

- [ ] **Step 3: Run the backfill once**

Run: `npm run backfill:regions`
Expected: logs counts per confidence (`gemi`/`name`/`geo`/`none`) for companies and branches; `none` entries are addresses no strategy could resolve (handle manually via the UI later).

- [ ] **Step 4: Spot-check**

Run: `npx tsx -e "import {prisma} from './lib/db'; (async()=>{const n=await prisma.company.count({where:{regionCode:{not:null}}}); const t=await prisma.company.count(); console.log('companies with region:', n, '/', t); await prisma.\$disconnect();})()"`
Expected: a non-trivial share of companies now have `regionCode`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-regions.ts package.json
git commit -m "feat(regions): one-time backfill of regionCode for existing companies & branches"
```

---

## Final verification

- [ ] `npm test` → all region unit tests pass.
- [ ] `npx tsc --noEmit` → no new type errors.
- [ ] `npm run build` → succeeds.
- [ ] Manual: `/admin/regions` tree + decoder; company form detect/picker/persist; branch detect/persist; actions-dropdown detect; `?` help icon opens the wiki page.
