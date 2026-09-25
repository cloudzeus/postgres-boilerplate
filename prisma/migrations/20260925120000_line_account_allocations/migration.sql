-- Επιμερισμός ΜΙΑΣ γραμμής παραστατικού σε 2+ λογαριασμούς γενικής.
--
-- ΜΟΝΟ ΠΡΟΣΘΗΚΗ: ένας νέος πίνακας. Καμία στήλη δεν αλλάζει, τίποτα δεν σβήνεται, καμία
-- υπάρχουσα γραμμή δεν πειράζεται. Παραστατικό χωρίς επιμερισμούς συμπεριφέρεται ΑΚΡΙΒΩΣ όπως
-- σήμερα — η μονή αντιστοίχιση (`softoneMtrl` / `softoneExpn` / `softoneLinMtrl`) μένει ως έχει.
--
-- `percent` είναι ό,τι δήλωσε ο χρήστης· `amount` είναι ό,τι στέλνεται, με τον τελευταίο
-- επιμερισμό να απορροφά το υπόλοιπο στρογγυλοποίησης ώστε το άθροισμα να κλείνει στο σεντ.
-- `accountCode` είναι ΑΝΤΙΓΡΑΦΟ του λογαριασμού τη στιγμή της επιλογής: αν αύριο αλλάξει η
-- χρεοπίστωση στο ERP, πρέπει να εξακολουθεί να φαίνεται πού στάλθηκε το ποσό.
--
-- ON DELETE CASCADE: οι επιμερισμοί δεν έχουν νόημα χωρίς τη γραμμή τους, και η γραμμή ήδη
-- σβήνει μαζί με το παραστατικό.

CREATE TABLE "OcrInvoiceItemAllocation" (
    "id"          TEXT NOT NULL,
    "itemId"      TEXT NOT NULL,
    "order"       INTEGER NOT NULL,
    "linMtrl"     INTEGER NOT NULL,
    "accountCode" TEXT,
    "percent"     DECIMAL(7,4) NOT NULL,
    "amount"      DECIMAL(18,4) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OcrInvoiceItemAllocation_pkey" PRIMARY KEY ("id")
);

-- Ένας επιμερισμός ανά (γραμμή, σειρά): η «σειρά» είναι η σταθερή ταυτότητα μέσα στη γραμμή.
CREATE UNIQUE INDEX "OcrInvoiceItemAllocation_itemId_order_key"
    ON "OcrInvoiceItemAllocation"("itemId", "order");

CREATE INDEX "OcrInvoiceItemAllocation_itemId_idx"
    ON "OcrInvoiceItemAllocation"("itemId");

-- Για «ποιες γραμμές χρεώθηκαν σε αυτόν τον λογαριασμό».
CREATE INDEX "OcrInvoiceItemAllocation_linMtrl_idx"
    ON "OcrInvoiceItemAllocation"("linMtrl");

ALTER TABLE "OcrInvoiceItemAllocation"
    ADD CONSTRAINT "OcrInvoiceItemAllocation_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "OcrInvoiceItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
