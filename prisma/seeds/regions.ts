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
