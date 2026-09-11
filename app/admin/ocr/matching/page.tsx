import { redirect } from 'next/navigation';

// Η σελίδα «Αντιστοιχίσεις SoftOne» αντικαταστάθηκε από τις δύο ουρές
// «Νέοι συναλλασσόμενοι» (/admin/ocr/new-traders) και «Είδη & έξοδα»
// (/admin/ocr/new-items) — spec 2026-09-11 §4. Ο παλιός σύνδεσμος (sidebar,
// σελιδοδείκτες, εσωτερικά links) οδηγεί εδώ και προωθεί στη δεύτερη.
export default function OcrMatchingPage() {
  redirect('/admin/ocr/new-items');
}
