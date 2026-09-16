-- Μνήμη geocoding: μια διεύθυνση κοστίζει ΜΙΑ κλήση στον πάροχο, για πάντα.
-- Κρατούνται και οι αστοχίες (found = false) — αυτές καίνε το ίδιο quota.
CREATE TABLE "GeocodeCache" (
  "id"          TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "address"     TEXT NOT NULL,
  "countryHint" TEXT,
  "found"       BOOLEAN NOT NULL DEFAULT false,
  "countryCode" TEXT,
  "country"     TEXT,
  "city"        TEXT,
  "zip"         TEXT,
  "formatted"   TEXT,
  "lat"         DOUBLE PRECISION,
  "lng"         DOUBLE PRECISION,
  "hits"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeocodeCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GeocodeCache_key_key" ON "GeocodeCache"("key");
CREATE INDEX "GeocodeCache_usedAt_idx" ON "GeocodeCache"("usedAt");
