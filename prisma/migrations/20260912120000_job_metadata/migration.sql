-- Μεταδεδομένα εργασίας σάρωσης (spec §12): ο χρήστης ονομάζει την παρτίδα που ανεβάζει, της δίνει
-- δική του σήμανση και ημερομηνία αναφοράς, και λέει ποιος θα ειδοποιηθεί όταν τελειώσει.
-- Η `docDate` ΔΕΝ είναι το `createdAt`: είναι η ημερομηνία που δηλώνει ο χρήστης για τα έγγραφα.
-- Όλα προαιρετικά — οι υπάρχουσες εργασίες (αν υπάρχουν) μένουν έγκυρες ως έχουν.
ALTER TABLE "TemplateJob" ADD COLUMN "title" TEXT;
ALTER TABLE "TemplateJob" ADD COLUMN "reference" TEXT;
ALTER TABLE "TemplateJob" ADD COLUMN "docDate" TIMESTAMP(3);
ALTER TABLE "TemplateJob" ADD COLUMN "description" TEXT;
ALTER TABLE "TemplateJob" ADD COLUMN "notifyEmails" TEXT;
