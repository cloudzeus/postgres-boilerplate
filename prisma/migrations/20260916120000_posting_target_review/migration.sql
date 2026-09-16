-- Προσθετικά, από το review του στόχου καταχώρισης.
-- Σημαδεύει αν ο κατάλογος κατηγοριών δαπανών φιλτραρίστηκε όντως σε SODTYPE 53.
ALTER TABLE "SoftoneLineCategory" ADD COLUMN "sodtypeFiltered" BOOLEAN NOT NULL DEFAULT true;
