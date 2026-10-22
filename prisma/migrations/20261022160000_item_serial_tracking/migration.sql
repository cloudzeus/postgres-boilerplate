-- Παρακολούθηση σειριακών αριθμών του είδους (MTRSNUSE, SNCODEMSK) στον καθρέφτη ειδών.
ALTER TABLE "SoftoneItem" ADD COLUMN "snUse" INTEGER;
ALTER TABLE "SoftoneItem" ADD COLUMN "snMask" TEXT;
