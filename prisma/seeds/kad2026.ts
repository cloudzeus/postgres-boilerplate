import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../lib/db';

type RawNode = {
  code: string;
  title: string;
  level: number;
  branches?: RawNode[];
  groups?: RawNode[];
  classes?: RawNode[];
  categories?: RawNode[];
  subcategories?: RawNode[];
  national_activities?: RawNode[];
  activities?: RawNode[];
};

type FlatKad = {
  code: string;
  codeWithoutDots: string;
  title: string;
  level: number;
  sector: string;
  sectorLetter: string;
  parentCode: string | null;
  path: string;
};

const CHILD_KEYS: (keyof RawNode)[] = [
  'branches', 'groups', 'classes', 'categories', 'subcategories',
  'national_activities', 'activities',
];

function flatten(
  node: RawNode,
  sectorLetter: string,
  parentCode: string | null,
  pathParts: string[],
  out: FlatKad[],
) {
  const path = [...pathParts, node.code].join('>');
  out.push({
    code: node.code,
    codeWithoutDots: node.code.replace(/\./g, ''),
    title: node.title,
    level: node.level,
    sector: sectorLetter,
    sectorLetter,
    parentCode,
    path,
  });
  for (const k of CHILD_KEYS) {
    const children = node[k] as RawNode[] | undefined;
    if (!children) continue;
    for (const child of children) {
      flatten(child, sectorLetter, node.code, [...pathParts, node.code], out);
    }
  }
}

async function main() {
  const jsonPath = path.join(process.cwd(), 'public', 'kad2025.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
    metadata: { version: string; total_codes: number };
    sectors: RawNode[];
  };

  const flat: FlatKad[] = [];
  for (const sector of raw.sectors) {
    flatten(sector, sector.code, null, [], flat);
  }
  console.log(`Flattened ${flat.length} KAD entries from ${raw.sectors.length} sectors`);

  // Insert in two passes to satisfy self-FK: parents-first ordering by level.
  flat.sort((a, b) => a.level - b.level);

  const BATCH = 100;
  let written = 0;
  for (let i = 0; i < flat.length; i += BATCH) {
    const slice = flat.slice(i, i + BATCH);
    await Promise.all(
      slice.map((f) =>
        prisma.kadCode.upsert({
          where: { code: f.code },
          create: {
            code: f.code,
            codeWithoutDots: f.codeWithoutDots,
            description: f.title,
            title: f.title,
            level: f.level,
            sector: f.sector,
            sectorLetter: f.sectorLetter,
            parentCode: f.parentCode,
            path: f.path,
            isActive: true,
          },
          update: {
            codeWithoutDots: f.codeWithoutDots,
            title: f.title,
            description: f.title,
            level: f.level,
            sector: f.sector,
            sectorLetter: f.sectorLetter,
            parentCode: f.parentCode,
            path: f.path,
          },
        }),
      ),
    );
    written += slice.length;
    if (written % 1000 === 0 || written === flat.length) {
      console.log(`  upserted ${written}/${flat.length}`);
    }
  }

  await prisma.kadImportLog.create({
    data: {
      totalCodes: flat.length,
      sourceVersion: raw.metadata.version,
      status: 'completed',
      notes: `from public/kad2025.json (${raw.sectors.length} sectors)`,
    },
  });

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
