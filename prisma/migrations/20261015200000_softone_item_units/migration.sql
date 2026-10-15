-- Μονάδες μέτρησης στον καθρέφτη ειδών (MTRUNIT1/3/4, MU31/MU41). Μόνο νέες nullable στήλες.
ALTER TABLE "SoftoneItem" ADD COLUMN "unit1" TEXT;
ALTER TABLE "SoftoneItem" ADD COLUMN "unitBuy" TEXT;
ALTER TABLE "SoftoneItem" ADD COLUMN "buyRatio" DOUBLE PRECISION;
ALTER TABLE "SoftoneItem" ADD COLUMN "unitSell" TEXT;
ALTER TABLE "SoftoneItem" ADD COLUMN "sellRatio" DOUBLE PRECISION;
