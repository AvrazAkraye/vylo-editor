import type { EffortBook } from './effort';
import type { Target } from './generate';
import type { Hint, WriteRequest } from './whatsappbulktypes';

/**
 * Writing messages with the model. PLACEHOLDER from Phase 0 (docs/WA.md): the `writer` package replaces this
 * file (write, improve, translate, shorten, variants; JSON only; the brief is the only thing from the person that
 * goes out, never a list of people). Names and signatures below are the contract.
 */
export async function writeMessages(
  _target: Target, _book: EffortBook, _req: WriteRequest, _o: { signal?: AbortSignal } = {},
): Promise<{ messages: string[]; said: string }> {
  return { messages: [], said: '' };
}

/** Plain hints about a message that may read as spam (shouting, many links, money words); pure, no model. */
export function riskHints(_text: string): Hint[] {
  return [];
}
