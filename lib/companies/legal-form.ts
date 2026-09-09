/** Strip Greek/Latin diacritics (NFD decomposition, drop combining marks). */
export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Canonicalise a Greek legal form to a comparable token, handling abbreviation ↔ full name:
 * «Ιδιωτική Κεφαλαιουχική Εταιρεία» → ΙΚΕ, «Ανώνυμη Εταιρεία» → ΑΕ, etc.
 */
export function canonicalLegalForm(s: string): string {
  const t = stripAccents(s).toUpperCase().replace(/[^Α-ΩA-Z]/g, '');
  // Κ.ΑΛ.Ο. / κοινωνικοί φορείς FIRST — many contain "Περιορισμένης Ευθύνης" or "Εταιρεία"
  // and must NOT be mistaken for ΕΠΕ / ΑΕ.
  if (/ΚΟΙΣΠΕ/.test(t) || (/ΚΟΙΝΩΝΙΚΟΣΣΥΝΕΤΑΙΡΙΣΜΟΣ/.test(t) && /ΠΕΡΙΟΡΙΣΜΕΝΗΣΕΥΘΥΝΗΣ/.test(t))) return 'ΚΟΙΣΠΕ';
  if (/ΚΟΙΝΣΕΠ/.test(t) || /ΚΟΙΝΩΝΙΚΗΣΥΝΕΤΑΙΡΙΣΤΙΚΗ/.test(t)) return 'ΚΟΙΝΣΕΠ';
  if (/ΣΥΝΕΤΑΙΡΙΣΜ/.test(t)) return 'ΣΥΝΕΤΑΙΡΙΣΜΟΣ';
  if (/ΑΣΤΙΚΗΜΗΚΕΡΔΟΣΚΟΠΙΚΗ/.test(t) || /^ΑΜΚΕ/.test(t)) return 'ΑΜΚΕ';
  // Εμπορικές μορφές
  if (/ΙΔΙΩΤΙΚΗΚΕΦΑΛΑΙΟΥΧΙΚΗ/.test(t) || t === 'ΙΚΕ' || t.endsWith('ΙΚΕ')) return 'ΙΚΕ';
  if (/ΑΝΩΝΥΜ/.test(t) || t === 'ΑΕ') return 'ΑΕ';
  // ΕΠΕ μόνο όταν είναι «Εταιρ(ε)ία Περιορισμένης Ευθύνης» και ΟΧΙ «Συνεταιρισμός».
  if (t === 'ΕΠΕ' || (/ΕΤΑΙΡ/.test(t) && /ΠΕΡΙΟΡΙΣΜΕΝΗΣΕΥΘΥΝΗΣ/.test(t) && !/ΣΥΝΕΤΑΙΡ/.test(t))) return 'ΕΠΕ';
  if (/ΟΜΟΡΡΥΘΜ/.test(t) || t === 'ΟΕ') return 'ΟΕ';
  if (/ΕΤΕΡΟΡΡΥΘΜ/.test(t) || t === 'ΕΕ') return 'ΕΕ';
  if (/ΑΤΟΜΙΚ/.test(t)) return 'ΑΤΟΜΙΚΗ';
  return t;
}
