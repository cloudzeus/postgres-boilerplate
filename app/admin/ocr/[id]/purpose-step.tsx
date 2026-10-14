'use client';

// Βήμα 1 του οδηγού αντιστοίχισης: «Τι αφορά αυτή η αγορά;» με καθημερινές κατηγορίες.
//
// Ο χρήστης δεν είναι λογιστής: για εκείνον το laptop, η βενζίνη, το leasing και ο λογαριασμός του
// ρεύματος είναι όλα «έξοδα». Εδώ διαλέγει ΤΙ αφορά — η εφαρμογή ξέρει πώς καταχωρείται (πάγιο,
// έξοδο, χρεοπίστωση, επιμερισμός) και το λέει με μία πρόταση, χωρίς να τον βάζει να το ξέρει.

import * as React from 'react';
import {
  FiAlertTriangle, FiHelpCircle, FiHome, FiMonitor, FiPackage, FiPieChart, FiTool, FiTruck, FiZap, FiCheck,
  FiCpu, FiLoader,
} from 'react-icons/fi';
import { cn } from '@/lib/utils';
import {
  availableTiles, blockedAdvice, quizOutcome, suggestTile, tileForPurpose, TILES,
  type QuizAnswers, type Tile,
} from '@/lib/ocr/purchase-purpose';
import type { PostingTarget } from '@/lib/ocr/posting-target';
import type { MatchKind } from '@/lib/ocr/line-match';
import type { PurposeAiAnswer } from '@/lib/ocr/purpose-ai';

const TILE_ICON: Record<Tile, React.ReactNode> = {
  equipment: <FiMonitor aria-hidden className="size-5" />,
  vehicle: <FiTruck aria-hidden className="size-5" />,
  rent: <FiHome aria-hidden className="size-5" />,
  bills: <FiZap aria-hidden className="size-5" />,
  services: <FiTool aria-hidden className="size-5" />,
  goods: <FiPackage aria-hidden className="size-5" />,
  split: <FiPieChart aria-hidden className="size-5" />,
};

export function PurposeStep({
  lineName, amount, target, defaultKind, hasRegistrySuggestion, current, onChoose, ai, aiBusy, onAskAi,
}: {
  lineName: string | null | undefined;
  amount: number | null | undefined;
  target: PostingTarget | null;
  defaultKind: MatchKind | null;
  hasRegistrySuggestion: boolean;
  /** Η κατηγορία της ΤΩΡΙΝΗΣ αντιστοίχισης (όταν ο χρήστης πάτησε «Αλλαγή»). */
  current: Tile | null;
  onChoose: (tile: Tile) => void;
  /** Η πρόταση του AI, αν ζητήθηκε — υπερισχύει της πρότασης των κανόνων. */
  ai: PurposeAiAnswer | null;
  aiBusy: boolean;
  onAskAi: () => void;
}) {
  const tiles = React.useMemo(() => availableTiles(target), [target]);
  const ruleSuggested = React.useMemo(
    () => suggestTile({ lineName, amount, hasRegistrySuggestion, defaultKind, target }),
    [lineName, amount, hasRegistrySuggestion, defaultKind, target],
  );
  const suggested = ai
    ? { tile: ai.tile, reason: ai.reason, blocked: tiles.find((t) => t.tile === ai.tile)?.blocked ?? false }
    : ruleSuggested;
  const [blockedOpen, setBlockedOpen] = React.useState<Tile | null>(suggested?.blocked ? suggested.tile : null);
  const [quizOpen, setQuizOpen] = React.useState(false);
  const [quiz, setQuiz] = React.useState<QuizAnswers>({});
  const outcome = quizOutcome(quiz);
  // Για «έξοδο» η απάντηση του κουίζ δεν λέει ΠΟΙΟ έξοδο — κρατάμε την κατηγορία της περιγραφής αν ταιριάζει.
  const quizTile: Tile | null = outcome == null ? null
    : outcome === 'expense' && suggested && TILES[suggested.tile].purpose === 'expense' ? suggested.tile
      : tileForPurpose(outcome);
  const quizTileBlocked = quizTile != null && (tiles.find((t) => t.tile === quizTile)?.blocked ?? true);

  const choose = (tile: Tile, blocked: boolean) => {
    if (blocked) { setBlockedOpen(tile); return; }
    onChoose(tile);
  };

  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-[length:var(--fs-13)] text-foreground">
        Διάλεξε <strong>τι αφορά</strong> η αγορά. Δεν χρειάζεται να ξέρεις λογιστική — η εφαρμογή ξέρει
        πώς καταχωρείται το καθένα (π.χ. ένα laptop ως εξοπλισμός, η βενζίνη ως έξοδο αυτοκινήτου).
      </p>

      <div className="flex flex-wrap items-start justify-between gap-2">
        {suggested ? (
          <p className="flex min-w-0 flex-1 items-start gap-1.5 text-[length:var(--fs-12)] text-muted-foreground">
            {ai ? <FiCpu aria-hidden className="mt-0.5 size-3.5 shrink-0 text-sisyphus-600" /> : <FiZap aria-hidden className="mt-0.5 size-3.5 shrink-0 text-sisyphus-600" />}
            <span>
              <strong className="text-foreground">{ai ? 'Πρόταση AI' : 'Πρόταση'}: {TILES[suggested.tile].title}.</strong> {suggested.reason}
              {ai && ai.confidence < 0.6 && <span className="text-amber-700 dark:text-amber-300"> (όχι πολύ σίγουρη — έλεγξέ τη)</span>}
            </span>
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-[length:var(--fs-12)] text-muted-foreground">Δεν βρήκαμε πρόταση από την περιγραφή.</p>
        )}
        {!ai && (
          <button
            type="button" onClick={onAskAi} disabled={aiBusy}
            className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-sisyphus-500/40 px-3 text-[length:var(--fs-12)] font-semibold text-sisyphus-700 outline-none hover:bg-sisyphus-500/10 focus-visible:ring-2 focus-visible:ring-sisyphus-500 disabled:opacity-60 dark:text-sisyphus-300"
          >
            {aiBusy ? <FiLoader aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" /> : <FiCpu aria-hidden className="size-3.5" />}
            {aiBusy ? 'Το AI σκέφτεται…' : 'Ρώτα το AI'}
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label="Τι αφορά η αγορά" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tiles.map(({ tile, blocked }) => {
          const def = TILES[tile];
          const isSuggested = suggested?.tile === tile;
          const isCurrent = current === tile;
          const highlighted = quizTile ? quizTile === tile : isSuggested;
          return (
            <button
              key={tile}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              onClick={() => choose(tile, blocked)}
              className={cn(
                'group relative flex min-h-[4.25rem] cursor-pointer items-start gap-3 rounded-xl border p-3 text-left outline-none',
                'cx-transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
                highlighted
                  ? 'border-sisyphus-500 bg-sisyphus-500/[0.06] shadow-fluent-2'
                  : 'border-border hover:border-sisyphus-500/50 hover:bg-[var(--cx-hover)]',
                blocked && 'border-dashed',
              )}
            >
              <span className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-lg',
                highlighted ? 'bg-sisyphus-500 text-white' : 'bg-muted text-foreground/80',
              )}>
                {TILE_ICON[tile]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[length:var(--fs-14)] font-semibold text-foreground">{def.title}</span>
                  {isSuggested && !quizTile && (
                    <span className="rounded-full bg-sisyphus-500 px-1.5 py-px text-[length:var(--fs-10)] font-semibold text-white">{ai ? 'Πρόταση AI' : 'Πρόταση'}</span>
                  )}
                  {isCurrent && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-px text-[length:var(--fs-10)] font-semibold text-emerald-800 dark:text-emerald-300">
                      <FiCheck aria-hidden className="size-3" /> Τώρα
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[length:var(--fs-12)] text-muted-foreground">{def.examples}</span>
                {blocked && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[length:var(--fs-11)] font-medium text-amber-800 dark:text-amber-300">
                    <FiAlertTriangle aria-hidden className="size-3" /> Δεν γίνεται σε αυτή τη σειρά — δες γιατί
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {blockedOpen && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-[length:var(--fs-12)] text-foreground">
          <FiAlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span><strong>{TILES[blockedOpen].title}:</strong> {blockedAdvice(TILES[blockedOpen].purpose)}</span>
        </div>
      )}

      {/* «Δεν είμαι σίγουρος» — δύο ερωτήσεις ναι/όχι, η ίδια σκέψη που κάνει ο λογιστής. */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          aria-expanded={quizOpen}
          onClick={() => setQuizOpen((o) => !o)}
          className="flex min-h-10 w-full cursor-pointer items-center gap-1.5 px-3 text-left text-[length:var(--fs-13)] font-semibold text-sisyphus-700 outline-none hover:bg-[var(--cx-hover)] focus-visible:ring-2 focus-visible:ring-sisyphus-500 dark:text-sisyphus-300"
        >
          <FiHelpCircle aria-hidden className="size-4" /> Δεν είμαι σίγουρος — βοήθησέ με να διαλέξω
        </button>
        {quizOpen && (
          <div className="space-y-2.5 border-t border-border px-3 py-2.5">
            <YesNo
              q="Θα το χρησιμοποιείτε για περισσότερο από έναν χρόνο;"
              hint="π.χ. ένας υπολογιστής ναι· η βενζίνη ή ένα χαρτί εκτυπωτή όχι"
              value={quiz.longTerm}
              onChange={(v) => setQuiz({ longTerm: v })}
            />
            {quiz.longTerm === true && (
              <YesNo
                q="Κόστισε πάνω από 150 € (το ένα τεμάχιο);"
                hint="Τα φθηνά μικροαντικείμενα (ποντίκι, καλώδιο) περνάνε απλώς ως έξοδο"
                value={quiz.expensive}
                onChange={(v) => setQuiz((a) => ({ ...a, expensive: v }))}
              />
            )}
            {quiz.longTerm === false && (
              <YesNo
                q="Το μεταπωλείτε ή γίνεται μέρος του προϊόντος σας;"
                hint="π.χ. εμπόρευμα για το κατάστημα, πρώτη ύλη για την παραγωγή"
                value={quiz.resale}
                onChange={(v) => setQuiz((a) => ({ ...a, resale: v }))}
              />
            )}
            {quizTile && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-sisyphus-500/[0.07] px-2.5 py-2">
                <span className="text-[length:var(--fs-13)] text-foreground">
                  Ταιριάζει: <strong>{TILES[quizTile].title}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => choose(quizTile, quizTileBlocked)}
                  className="inline-flex min-h-9 cursor-pointer items-center rounded-md bg-sisyphus-500 px-3 text-[length:var(--fs-13)] font-semibold text-white hover:bg-sisyphus-600"
                >
                  Συνέχεια με αυτό
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function YesNo({ q, hint, value, onChange }: { q: string; hint: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  const id = React.useId();
  return (
    <fieldset aria-describedby={`${id}-h`}>
      <legend className="text-[length:var(--fs-13)] font-medium text-foreground">{q}</legend>
      <p id={`${id}-h`} className="text-[length:var(--fs-11)] text-muted-foreground">{hint}</p>
      <div className="mt-1.5 flex gap-2">
        {([true, false] as const).map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={cn(
              'min-h-9 min-w-16 cursor-pointer rounded-md border px-3 text-[length:var(--fs-13)] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-sisyphus-500',
              value === v ? 'border-sisyphus-500 bg-sisyphus-500 text-white' : 'border-input hover:bg-[var(--cx-hover)]',
            )}
          >
            {v ? 'Ναι' : 'Όχι'}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
