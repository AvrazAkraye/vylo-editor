import { LABELS, SWATCHES, tagOf, type Tag } from './tags';

/**
 * Eight colours and a way back to none.
 *
 * Buttons rather than a `<select>`, because the choice *is* the colour: a
 * dropdown listing the word "violet" makes somebody read a list to find a thing
 * they would have recognised instantly.
 *
 * Each swatch still carries its name as `aria-label` and `title`. That is not a
 * concession — a control whose entire meaning is colour is unusable to anyone
 * who cannot distinguish two of them, and the name is the only text a tag has.
 */
export function TagPicker(
  { value, onPick, t }:
  { value: unknown; onPick: (tag: Tag) => void; t: (s: string) => string },
) {
  const current = tagOf(value);
  return (
    <div className="tagpick" role="group" aria-label={t('Colour')}>
      {/* `none` first, because clearing is the thing somebody comes back for. */}
      <button className={`none ${current === 'none' ? 'on' : ''}`}
              onClick={() => onPick('none')}
              title={t(LABELS.none)} aria-label={t(LABELS.none)}
              aria-pressed={current === 'none'} />
      {SWATCHES.map((tag) => (
        <button key={tag} className={`${current === tag ? 'on' : ''}`}
                style={{ background: `var(--tag-${tag})` }}
                onClick={() => onPick(tag)}
                title={t(LABELS[tag])} aria-label={t(LABELS[tag])}
                aria-pressed={current === tag} />
      ))}
    </div>
  );
}
