# Learning & Posting Classification Layer — Requirements (from the customer, 2026-09-10)

> Input document for a future spec/plan (after extraction-templates plans 2–4). Recorded as received, lightly structured. My assessment is in the conversation of 2026-09-10 and summarised at the end.

## Scope
The existing app already scans documents, extracts header+lines, identifies/creates suppliers and items, and prepares/posts lines. **Do not redesign that.** The new layer learns the **accounting posting decision** from confirmed user decisions and proposes it for similar documents.

## Principles
- Learning = storing, evaluating, scoring and reusing **confirmed human** posting decisions. No custom ML model initially. Never learn from an unconfirmed AI suggestion.
- Two concepts per document: document understanding (exists) vs. accounting posting decision (new).
- A posting decision = complete combination: category (PURCHASE, EXPENSE, FIXED_ASSET, SALE, RECEIPT, PAYMENT, BANK, SECURITY, ACCOUNTING, OTHER), SoftOne object, SoftOne series, GL account, VAT treatment, cost center, branch, project, fixed-asset category, other SoftOne metadata. Remember the whole combination, not just the category.
- First-time processing: user makes/confirms the decision; stored with the document's characteristics.
- Multi-dimensional learning (never a plain supplier→account map): supplier VAT (strongest), supplier identity, document type/subtype, series, line descriptions, item identities, item categories, keywords, VAT rates, totals, previous confirmed decisions, semantic similarity.
- Exact deterministic rules generated from confirmed decisions; **specificity precedence**: supplier+item+docType > supplier+docType+keywords > supplier+docType > supplier only > global. A generic rule never overrides a more specific confirmed rule.
- Supplier Posting Profile = collection of observed/confirmed patterns per supplier.
- Historical examples never overwritten; audit trail always.

## Data concepts
- **PostingDecision** (per document): documentId, suggestionSource, suggested{Category,SeriesId,AccountId,VatId,CostCenterId,BranchId,ProjectId,FixedAssetCategoryId}, confidence, reason, final{…same}, confirmedBy, confirmedAt, corrected, createdAt. Never delete original suggestions.
- **PostingRule**: supplierId?, supplierVat?, documentType?, documentSubtype?, itemId?, itemCategoryId?, descriptionPattern?, keywords, category, softoneSeriesId, accountId, vatId, costCenterId, branchId, projectId, fixedAssetCategoryId, priority, specificityScore, confirmationCount, correctionCount, lastUsedAt, active, timestamps. Stats: timesMatched, timesConfirmed, timesCorrected, lastMatchedAt, lastConfirmedAt → reliability score (corrections count negatively; decay when unused and contradicted).
- **PostingExample** (optional): documentId, supplierId, normalizedText, documentType, lineSignature, postingDecisionId, embedding.

## Learning from feedback
- Confirm without changes → reinforce matching pattern, counts, lastUsed, maybe create rule.
- Change suggestion → do not reinforce; store corrected final; increment correction count of the rule that caused it; create/update corrected pattern (corrections are more valuable than confirmations; e.g. Plaisio EXPENSE vs. MacBook Pro → FIXED_ASSET).
- Rule creation: not after every document. Store example first; second occurrence → suggest from example; third consistent confirmation → promote to rule (configurable). Explicit "Remember this choice" action with scope (exact item / line type from supplier / doc type from supplier / all from supplier — broadest with care).
- Line-level learning: each line can carry its own mapping (supplier+item, supplier+normalized description, supplier+item category → category, account, asset category, VAT, cost center). Item accounting profile with supplier-specific and purpose-specific overrides.

## Matching pipeline (before any AI call)
1 exact deterministic rule → 2 specific supplier pattern → 3 historical document similarity → 4 semantic similarity (pgvector, confirmed examples only, supplier-first then family then global) → 5 AI (OpenRouter) choosing ONLY from provided candidates (series, accounts, VAT, asset categories, profile, similar docs, rule results) → 6 manual.

## Confidence
Evidence-based, transparent (no bare percentage). Signals: VAT match, doc type match, item match, item category match, keywords, historical frequency, correction rate, semantic similarity, recency, number of matching confirmed docs. Thresholds (configurable): ≥0.95 trusted (preselect, still confirm initially); 0.80–0.949 strong (visible confirmation); <0.80 manual review. **No automatic posting in v1 based on confidence alone.**

## UX & admin
- Frictionless feedback in the normal review screen: suggested value, confidence, reason, previous examples; direct correction; on confirm persist decision, update rule stats, supplier and item profiles, embeddings.
- Explainability: every suggestion traceable to evidence (never "AI decided").
- Conflicting knowledge: evaluate specificity, recency, context; prefer newer specific rule; otherwise lower confidence + manual confirmation.
- Rule management UI: view/why/counts/training docs, disable, edit, priority, archive, merge duplicates, inspect supplier profiles. All learned behaviour inspectable and editable.
- Normalization before matching (whitespace, case, Greek accents, punctuation, abbreviations, VAT numbers, supplier name variants); keep originals.
- Audit per classification: rules evaluated, rule matched, examples used, similarity scores, AI request/result, initial suggestion, final decision, user, timestamp, SoftOne posting result.

## Assessment (Claude, 2026-09-10)
Sound design; complements the extraction templates (understanding vs. decision layers). Prerequisites not yet in the app: SoftOne mirrors for GL accounts, cost centers, projects, asset categories; posting adapters for objects other than PURDOC (expenses, assets, GL articles). Align the category enum with the series areas (Αγορές, Έξοδα, Πάγια…) so candidate series come from the enabled series registry. Use a concrete reliability formula (Laplace (c+1)/(c+k+2) × recency × specificity). Start with lexical/trigram similarity, add pgvector later. AUTO posting only for very high reliability rules, later. Template conditions become "explicit rules" at the top of the knowledge hierarchy. Build after extraction-templates plan 3.
