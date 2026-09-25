// Ο λογαριασμός γενικής λογιστικής μιας γραμμής, όπως τον βγάζει ο έλεγχος
// (`lib/ocr/account-check.ts`). ΜΟΝΟ παρουσίαση — καμία κρίση εδώ. Χρησιμοποιείται στην
// προεπισκόπηση καταχώρισης και στη στήλη «SoftOne» του πίνακα γραμμών.
//
// Ο λογαριασμός που ΥΠΑΡΧΕΙ δείχνεται πάντα με το όνομά του στο σχέδιο: έτσι ένα «Ύδρευση →
// Έξοδα εκθέσεων» γίνεται ορατό στον άνθρωπο — η εφαρμογή δεν μαντεύει αν το νόημα ταιριάζει.
import { FiBookOpen, FiHelpCircle, FiXCircle } from 'react-icons/fi';
import type { AccountCheckLine } from '@/lib/ocr/account-check';

const RED = '#B91C1C';
const AMBER = '#B45309';

export function AccountLine({ line, compact = false }: { line: AccountCheckLine; compact?: boolean }) {
  const code = line.account ? <code className="font-mono text-[length:var(--fs-11)]">{line.account}</code> : null;
  const wrap = 'flex items-start gap-1 text-[length:var(--fs-11)] leading-snug';

  switch (line.status) {
    case 'ok':
      return (
        <p className={wrap} title="Λογαριασμός γενικής λογιστικής (από την καρτέλα της χρεοπίστωσης)">
          <FiBookOpen className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="text-muted-foreground">Λογ/σμός </span>{code}
            <span className="text-foreground"> — {line.accountName}</span>
            {line.inactive && <span style={{ color: AMBER }}> (ανενεργός)</span>}
            {line.vatMismatch && (
              // ΠΑΡΑΤΗΡΗΣΗ, όχι εμπόδιο: συμπέρασμα από το σχήμα του σχεδίου (βλ. `accountVatRate`).
              <span className="block" style={{ color: AMBER }}>
                Ο λογαριασμός είναι για {line.vatMismatch.accountRate === 0 ? 'άνευ ΦΠΑ' : `ΦΠΑ ${line.vatMismatch.accountRate}%`}
                {' '}αλλά η γραμμή έχει ΦΠΑ {line.vatMismatch.lineRate}% — έλεγξε τη χρεοπίστωση
              </span>
            )}
          </span>
        </p>
      );
    case 'mask':
      return (
        <div className={wrap} style={{ color: RED }}>
          <FiXCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <div>
            <span>Μάσκα λογ/σμού {code} αντί για λογαριασμό — δεν καταχωρείται</span>
            <span className="block text-muted-foreground">
              {line.matchCount === 0
                ? 'Κανένας κινούμενος λογαριασμός δεν ταιριάζει στη μάσκα'
                : <>Υποψήφιοι ({line.matchCount}): {line.matches.slice(0, compact ? 3 : line.matches.length).map((m) => `${m.code} «${m.name}»`).join(', ')}
                  {line.matchCount > (compact ? 3 : line.matches.length) ? ` και άλλοι ${line.matchCount - (compact ? 3 : line.matches.length)}` : ''}</>}
            </span>
          </div>
        </div>
      );
    case 'not_postable':
      return (
        <p className={wrap} style={{ color: RED }}>
          <FiXCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>Λογ/σμός {code} — {line.accountName}: συγκεντρωτικός λογαριασμός, δεν δέχεται εγγραφές</span>
        </p>
      );
    case 'missing':
      return (
        <p className={wrap} style={{ color: RED }}>
          <FiXCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>Χωρίς λογαριασμό γενικής στο SoftOne</span>
        </p>
      );
    case 'not_in_chart':
      return (
        <div className={wrap} style={{ color: RED }}>
          <FiXCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <div>
            <span>Λογ/σμός {code} — δεν υπάρχει στο λογιστικό σχέδιο</span>
            {line.parent && (
              <span className="block text-muted-foreground">
                Υπάρχει ο {line.parent.code} «{line.parent.name}»
                {line.siblings.length > 0 && (
                  <>: {line.siblings.slice(0, compact ? 4 : line.siblings.length).map((s) => `${s.code} «${s.name}»`).join(', ')}
                    {compact && line.siblings.length > 4 ? ' …' : ''}</>
                )}
              </span>
            )}
          </div>
        </div>
      );
    case 'unknown':
      return (
        <p className={`${wrap} text-muted-foreground`}>
          <FiHelpCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>
            {line.account ? <>Λογ/σμός {code} · </> : null}
            {line.accountName ? <>{line.accountName} · </> : null}
            {line.unknownReason === 'chart_not_synced'
              ? 'το λογιστικό σχέδιο δεν έχει συγχρονιστεί'
              : line.unknownReason === 'postability_unknown'
                ? 'δεν ξέρουμε αν δέχεται εγγραφές — συγχρόνισε το λογιστικό σχέδιο'
                : 'ο λογαριασμός της χρεοπίστωσης δεν έχει διαβαστεί — συγχρόνισε τις χρεοπιστώσεις'}
          </span>
        </p>
      );
    case 'not_covered':
      return (
        <p className={`${wrap} text-muted-foreground`}>
          <FiHelpCircle className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>Λογαριασμός γενικής: δεν ελέγχεται ακόμη για αυτόν τον τύπο γραμμής</span>
        </p>
      );
  }
}
