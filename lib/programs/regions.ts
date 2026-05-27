// Canonical list of the 13 Greek regions (Περιφέρειες) and helpers to expand
// grouped entries that the LLM may return as composites.

export const GREEK_REGIONS = [
  'Ανατολική Μακεδονία – Θράκη',
  'Κεντρική Μακεδονία',
  'Δυτική Μακεδονία',
  'Ήπειρος',
  'Θεσσαλία',
  'Ιόνια Νησιά',
  'Δυτική Ελλάδα',
  'Στερεά Ελλάδα',
  'Πελοπόννησος',
  'Αττική',
  'Βόρειο Αιγαίο',
  'Νότιο Αιγαίο',
  'Κρήτη',
] as const;

const NORMALIZE_MAP: Array<[RegExp, typeof GREEK_REGIONS[number]]> = [
  [/ανατ.{0,3}μακεδονια.{0,3}θρακη/i, 'Ανατολική Μακεδονία – Θράκη'],
  [/κεντρ.{0,3}μακεδονια/i,          'Κεντρική Μακεδονία'],
  [/δυτ.{0,3}μακεδονια/i,            'Δυτική Μακεδονία'],
  [/ηπειρος/i,                       'Ήπειρος'],
  [/θεσσαλια/i,                      'Θεσσαλία'],
  [/ιονια\s*νησια/i,                 'Ιόνια Νησιά'],
  [/δυτ.{0,3}ελλαδα/i,               'Δυτική Ελλάδα'],
  [/στερεα\s*ελλαδα/i,               'Στερεά Ελλάδα'],
  [/πελοποννησος/i,                  'Πελοπόννησος'],
  [/αττικη/i,                        'Αττική'],
  [/βορ(ε)?ιο\s*αιγαιο/i,            'Βόρειο Αιγαίο'],
  [/νοτιο\s*αιγαιο/i,                'Νότιο Αιγαίο'],
  [/κρητη/i,                         'Κρήτη'],
];

function stripAccents(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Try to map an arbitrary region label to one of the 13 canonical names. */
export function canonicalizeRegion(raw: string): string | null {
  const key = stripAccents(raw).toLowerCase().trim();
  for (const [re, canonical] of NORMALIZE_MAP) {
    if (re.test(key)) return canonical;
  }
  return null;
}

interface RawRegion { name: string; fundingRate?: number | null; notes?: string | null }

/**
 * Expand grouped region entries into individual regions.
 *   Input:  [{ name: "Λιγότερο Ανεπτυγμένες (Κρήτη, Ήπειρος, Θεσσαλία)", fundingRate: 60 }]
 *   Output: [{name:"Κρήτη",fundingRate:60,notes:"Λιγότερο Ανεπτυγμένες"}, ...]
 */
export function expandRegionGroups(regions: RawRegion[]): RawRegion[] {
  const out: RawRegion[] = [];
  const seen = new Set<string>();

  for (const r of regions) {
    if (!r?.name) continue;
    // 1. Try direct canonicalization of the whole name.
    const direct = canonicalizeRegion(r.name);
    if (direct) {
      if (!seen.has(direct)) {
        seen.add(direct);
        out.push({ name: direct, fundingRate: r.fundingRate ?? null, notes: r.notes ?? null });
      }
      continue;
    }

    // 2. Look for parenthesized list of region names inside the label.
    const parenMatch = r.name.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const inside = parenMatch[1];
      const parts = inside.split(/[,;·•]| και /).map((s) => s.trim()).filter(Boolean);
      const groupLabel = r.name.replace(/\s*\(.*?\)\s*/, '').replace(/^[-–—:\s]+|[-–—:\s]+$/g, '').trim() || (r.notes ?? null);
      let matchedAny = false;
      for (const p of parts) {
        const c = canonicalizeRegion(p);
        if (c && !seen.has(c)) {
          seen.add(c);
          out.push({ name: c, fundingRate: r.fundingRate ?? null, notes: groupLabel });
          matchedAny = true;
        }
      }
      if (matchedAny) continue;
    }

    // 3. Look for canonical region names embedded in a longer string.
    let matchedEmbedded = false;
    for (const [re, canonical] of NORMALIZE_MAP) {
      if (re.test(stripAccents(r.name).toLowerCase())) {
        if (!seen.has(canonical)) {
          seen.add(canonical);
          out.push({ name: canonical, fundingRate: r.fundingRate ?? null, notes: r.notes ?? null });
        }
        matchedEmbedded = true;
      }
    }
    if (matchedEmbedded) continue;

    // 4. Otherwise keep the entry as-is (might be "Όλη η Ελλάδα" or similar).
    if (!seen.has(r.name)) {
      seen.add(r.name);
      out.push(r);
    }
  }

  return out;
}
