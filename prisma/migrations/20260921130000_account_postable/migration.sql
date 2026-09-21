-- ACNMOVING «Κινείται» του λογαριασμού: δέχεται εγγραφές ή είναι συγκεντρωτικός. ΜΟΝΟ ΠΡΟΣΘΗΚΗ:
-- μία nullable στήλη. NULL μέχρι τον επόμενο συγχρονισμό — ο έλεγχος το διαβάζει ως «άγνωστο».
ALTER TABLE "SoftoneAccount" ADD COLUMN "postable" BOOLEAN;
