import * as React from 'react';
import { FiHash } from 'react-icons/fi';

/**
 * Οι σειριακοί αριθμοί (S/N) μιας γραμμής, ως ετικέτες κάτω από την περιγραφή.
 *
 * Μέχρι τώρα δεν φαίνονταν πουθενά: ζούσαν μέσα στο κείμενο της περιγραφής και χάνονταν στο μάτι.
 * Ξεχωριστά, σε σταθερό πλάτος χαρακτήρα, διαβάζονται και συγκρίνονται με την ετικέτα της συσκευής.
 * Επιλέξιμο κείμενο — ο χρήστης τους αντιγράφει για αναζήτηση/εγγύηση.
 */
export function SerialChips({ serials }: { serials: readonly string[] | null | undefined }) {
  if (!serials?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1" aria-label={`Σειριακοί αριθμοί: ${serials.join(', ')}`}>
      <span className="inline-flex items-center gap-0.5 text-[length:var(--fs-10)] font-bold uppercase tracking-wide text-muted-foreground">
        <FiHash className="size-3" aria-hidden /> S/N
      </span>
      {serials.map((sn) => (
        <span key={sn} className="select-all rounded border border-border bg-muted/60 px-1.5 py-px font-mono text-[length:var(--fs-11)] text-foreground">
          {sn}
        </span>
      ))}
    </span>
  );
}
