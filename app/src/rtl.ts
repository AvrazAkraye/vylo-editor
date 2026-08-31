/**
 * Interface direction.
 *
 * Three of the four languages this app ships in — Arabic, Central Kurdish
 * (Sorani) and Badini — are written right to left, and until now the app set
 * `lang` on the document and left `dir` alone in all four. That was recorded as
 * a decision ("only the text runs right-to-left, and the browser does that on
 * its own"), and it is true of a *line* and false of a *layout*: bidi reorders
 * the glyphs inside a run, and nothing else. It does not move the sidebar to the
 * other side of the workspace, put the caret at the other end of a row, send an
 * ellipsis to the other end of a name, or reverse the reading order of a toolbar.
 * `dir` is what does all of that, and without it the app's primary market got an
 * interface with every panel on the wrong side — a defect invisible to anyone
 * testing in English, which is why it survived to 0.28.1.
 *
 * ## dir is derived from lang, not kept in step with it
 *
 * The mapping lives in `dirFor` and the attribute is written by `watchLang`,
 * which observes `lang` on the document element. So there is one owner, and a
 * call site that sets the language cannot forget the direction — which is
 * exactly how the two came to disagree in the first place. `applyDir` is the
 * before-first-paint version of the same thing, called from `main.tsx` beside
 * `applyTheme`, so the window never shows one frame of a left-to-right layout
 * on its way to a right-to-left one.
 *
 * ## What does not follow the interface
 *
 * Source code, a diff and its +/- gutter, the terminal, and a shell command
 * waiting for approval. Those are pinned `direction:ltr` in `styles.css` under
 * "code does not mirror" — a right-to-left CodeMirror is a serious bug and not
 * a translation, and a command whose characters have been reordered is not one
 * anybody can approve. The brand mark does not mirror either, which is why
 * nothing here flips images by rule: the three glyphs that genuinely point at
 * content (the two tree carets and the back/forward pair) are flipped one at a
 * time in the stylesheet.
 */

export type Dir = 'ltr' | 'rtl';

/**
 * The right-to-left interface languages, by ISO 639 subtag.
 *
 * `kmr` is here because this app ships Badini — Northern Kurdish as written in
 * Duhok, in the Arabic script — and would not be for the Latin orthography
 * Kurmanji usually takes. The script decides the direction; the language does
 * not, which is the trap a list like this exists to hold the answer to.
 */
const RTL_LANGS: readonly string[] = ['ar', 'ckb', 'kmr'];

/**
 * The direction a language tag is written in.
 *
 * Anything unrecognised is `ltr`, deliberately, and not an error. This is called
 * with whatever `localStorage` holds, and a stored value is input rather than
 * memory: getting one unknown code's direction wrong is cosmetic, and throwing
 * on it is a blank window before first paint.
 *
 * Only the primary subtag decides, so `ar-EG` is right-to-left for the same
 * reason `ar` is and a region this app never shipped cannot flip a language.
 */
export function dirFor(lang: string | null | undefined): Dir {
  if (typeof lang !== 'string') return 'ltr';
  const base = lang.trim().toLowerCase().split(/[-_]/)[0];
  return RTL_LANGS.includes(base) ? 'rtl' : 'ltr';
}

/**
 * Stamp both attributes, before the first paint.
 *
 * `lang` tells the text stack which script to shape and which fonts to prefer;
 * `dir` decides the layout. They are written together here because at startup
 * there is no earlier `lang` for the observer to have reacted to.
 */
export function applyDir(lang: string): Dir {
  const root = document.documentElement;
  const dir = dirFor(lang);
  root.lang = lang;
  root.dir = dir;
  return dir;
}

/**
 * Keep `dir` derived from `lang`, whoever sets `lang`.
 *
 * The same shape as `watchSystem` in `theme.ts`: subscribe, return the
 * unsubscribe. Started once from `main.tsx` for the life of the window, so the
 * language picker — and anything else that ever sets the document language —
 * gets the layout for free rather than having to remember a second line.
 */
export function watchLang(): () => void {
  const root = document.documentElement;
  const sync = () => {
    const dir = dirFor(root.lang);
    if (root.dir !== dir) root.dir = dir;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['lang'] });
  return () => observer.disconnect();
}
