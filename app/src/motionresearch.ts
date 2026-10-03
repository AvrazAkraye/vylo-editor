/**
 * Motion's Ask finds the facts itself. PLACEHOLDER from Phase 0 (docs/VM.md):
 * the `ask` package replaces this file with `researchWeb`, `factsBlock` and
 * `factNumbers`. The types below are the contract; keep their names.
 */
export interface Source {
  title: string;
  url: string;
}

export interface WebFact {
  text: string;
  source: Source;
}

export interface Research {
  query: string;
  facts: WebFact[];
  at: number;
  refused?: 'wire' | 'gateway' | 'none';
}

/** Placeholder so the type is used; the package replaces it. */
export const NO_RESEARCH: Research = { query: '', facts: [], at: 0 };
