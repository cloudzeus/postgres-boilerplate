-- ΣΕΙΡΑ DEPLOY: σε κάθε περιβάλλον τρέξε πρώτα `npm run templates:migrate-field-rules`
-- και μετά `prisma migrate deploy`. Το script διαβάζει τους δύο πίνακες που το migration
-- διαγράφει· αν τρέξει μετά, οι υπάρχοντες κανόνες προμηθευτών χάνονται χωρίς να μεταφερθούν.
DROP TABLE IF EXISTS "SupplierFieldRule";
DROP TABLE IF EXISTS "SupplierTemplate";
