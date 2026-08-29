import { useEffect, useState } from 'react';
import { grammarsReady, loadGrammars } from './highlight';

/**
 * True once the syntax grammars have arrived, re-rendering when they do.
 *
 * They are a few hundred kilobytes of parser tables loaded on demand, so
 * anything that highlights has to render plain first and colour a moment later.
 * `loadGrammars` returns one shared promise, so a transcript full of code
 * blocks and a review pane full of files together cost one download.
 *
 * Shared rather than duplicated per surface: two copies of this would drift,
 * and one of them would be the one that forgets to unsubscribe.
 */
export function useGrammars(): boolean {
  const [ready, setReady] = useState(grammarsReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadGrammars().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [ready]);
  return ready;
}
