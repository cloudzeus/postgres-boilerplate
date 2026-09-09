'use client';

import { Button } from '@/lib/design-system';

// Η παλιά διαδρομή DELETE /api/admin/ocr/templates?id=… δεν υπάρχει πλέον (το
// SupplierTemplate αντικαθίσταται από το ExtractionTemplate). Μέχρι να μεταφερθεί
// η λίστα στη νέα σελίδα προτύπων, το κουμπί μένει ανενεργό αντί να καλεί ένα
// endpoint που επιστρέφει 405 — μια σιωπηλή αποτυχία που μοιάζει με επιτυχία.
export function DeleteTemplateButton({ id: _id }: { id: string }) {
  return (
    <Button variant="danger" size="sm" disabled title="Η διαγραφή μεταφέρεται στη νέα σελίδα προτύπων">
      Διαγραφή
    </Button>
  );
}
