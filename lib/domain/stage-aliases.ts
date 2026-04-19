/**
 * stage-aliases — Input normalizer for pipeline stage literals.
 *
 * The canonical vocabulary is English-only:
 *     'junk' | 'contacted' | 'offered' | 'won'
 *
 * This module exists only to tolerate legacy Turkish spellings
 * (`gorusuldu` / `teklif` / `satis`) at EXTERNAL input boundaries — e.g. a
 * webhook from a tenant whose integration hasn't cycled to the new lexicon
 * yet. Anything that flows INSIDE the system (type signatures, DB columns,
 * enum comparisons, RPC args) is English-only and MUST NOT carry Turkish
 * literals.
 *
 * This file is intentionally tiny. If you're tempted to add more translation
 * logic here, reconsider whether that boundary belongs inside the core domain
 * or should be a thin adapter at the edge.
 */

export type CanonicalStage = 'junk' | 'contacted' | 'offered' | 'won';

/**
 * Normalize any stage spelling (legacy Turkish or canonical English,
 * arbitrary case / whitespace) into the canonical English representation.
 * Returns `null` for unknown inputs.
 */
export function normalizeStage(input: string | null | undefined): CanonicalStage | null {
  if (!input || typeof input !== 'string') return null;
  const key = input.trim().toLowerCase();
  if (key === 'junk') return 'junk';
  if (key === 'contacted' || key === 'gorusuldu') return 'contacted';
  if (key === 'offered' || key === 'teklif') return 'offered';
  if (key === 'won' || key === 'satis') return 'won';
  return null;
}

/** True iff `value` is a recognized stage literal (either spelling). */
export function isKnownStage(value: unknown): value is CanonicalStage {
  return typeof value === 'string' && normalizeStage(value) !== null;
}
