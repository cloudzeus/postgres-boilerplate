'use client';

import * as React from 'react';

// ISO 3166-1 alpha-2 country codes with Greek names.
// Greece pinned at the top as the default selection.
export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'GR', name: 'Ελλάδα' },
  // EU & common partners
  { code: 'CY', name: 'Κύπρος' },
  { code: 'DE', name: 'Γερμανία' },
  { code: 'FR', name: 'Γαλλία' },
  { code: 'IT', name: 'Ιταλία' },
  { code: 'ES', name: 'Ισπανία' },
  { code: 'PT', name: 'Πορτογαλία' },
  { code: 'NL', name: 'Ολλανδία' },
  { code: 'BE', name: 'Βέλγιο' },
  { code: 'LU', name: 'Λουξεμβούργο' },
  { code: 'AT', name: 'Αυστρία' },
  { code: 'CH', name: 'Ελβετία' },
  { code: 'IE', name: 'Ιρλανδία' },
  { code: 'GB', name: 'Ηνωμένο Βασίλειο' },
  { code: 'DK', name: 'Δανία' },
  { code: 'SE', name: 'Σουηδία' },
  { code: 'NO', name: 'Νορβηγία' },
  { code: 'FI', name: 'Φινλανδία' },
  { code: 'IS', name: 'Ισλανδία' },
  { code: 'PL', name: 'Πολωνία' },
  { code: 'CZ', name: 'Τσεχία' },
  { code: 'SK', name: 'Σλοβακία' },
  { code: 'HU', name: 'Ουγγαρία' },
  { code: 'RO', name: 'Ρουμανία' },
  { code: 'BG', name: 'Βουλγαρία' },
  { code: 'SI', name: 'Σλοβενία' },
  { code: 'HR', name: 'Κροατία' },
  { code: 'RS', name: 'Σερβία' },
  { code: 'MK', name: 'Βόρεια Μακεδονία' },
  { code: 'AL', name: 'Αλβανία' },
  { code: 'BA', name: 'Βοσνία και Ερζεγοβίνη' },
  { code: 'ME', name: 'Μαυροβούνιο' },
  { code: 'XK', name: 'Κόσοβο' },
  { code: 'TR', name: 'Τουρκία' },
  { code: 'EE', name: 'Εσθονία' },
  { code: 'LV', name: 'Λετονία' },
  { code: 'LT', name: 'Λιθουανία' },
  { code: 'MT', name: 'Μάλτα' },
  // Americas
  { code: 'US', name: 'Η.Π.Α.' },
  { code: 'CA', name: 'Καναδάς' },
  { code: 'MX', name: 'Μεξικό' },
  { code: 'BR', name: 'Βραζιλία' },
  { code: 'AR', name: 'Αργεντινή' },
  { code: 'CL', name: 'Χιλή' },
  // Middle East & Africa
  { code: 'IL', name: 'Ισραήλ' },
  { code: 'AE', name: 'Η.Α.Ε.' },
  { code: 'SA', name: 'Σαουδική Αραβία' },
  { code: 'QA', name: 'Κατάρ' },
  { code: 'EG', name: 'Αίγυπτος' },
  { code: 'MA', name: 'Μαρόκο' },
  { code: 'ZA', name: 'Νότια Αφρική' },
  // Asia & Oceania
  { code: 'CN', name: 'Κίνα' },
  { code: 'JP', name: 'Ιαπωνία' },
  { code: 'KR', name: 'Νότια Κορέα' },
  { code: 'IN', name: 'Ινδία' },
  { code: 'SG', name: 'Σιγκαπούρη' },
  { code: 'HK', name: 'Χονγκ Κονγκ' },
  { code: 'TW', name: 'Ταϊβάν' },
  { code: 'TH', name: 'Ταϊλάνδη' },
  { code: 'AU', name: 'Αυστραλία' },
  { code: 'NZ', name: 'Νέα Ζηλανδία' },
  // Rest
  { code: 'RU', name: 'Ρωσία' },
  { code: 'UA', name: 'Ουκρανία' },
  { code: 'GE', name: 'Γεωργία' },
  { code: 'AM', name: 'Αρμενία' },
];

export const DEFAULT_COUNTRY = 'GR';

export function countryName(code: string | null | undefined): string {
  if (!code) return '';
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

export function CountrySelect({
  id, value, onChange, allowEmpty = false, className,
}: {
  id?: string;
  value: string | null | undefined;
  onChange: (code: string) => void;
  allowEmpty?: boolean;
  className?: string;
}) {
  return (
    <select
      id={id}
      className={`h-8 w-full rounded-sm border border-input bg-background px-2 text-[12px] ${className ?? ''}`}
      value={value ?? DEFAULT_COUNTRY}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && <option value="">— Επίλεξε χώρα —</option>}
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name} ({c.code})
        </option>
      ))}
    </select>
  );
}
