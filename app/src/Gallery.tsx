import { useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * The parts a module's gallery home is built from — Research's and Video's
 * (ResearchHome.tsx, VideoHome.tsx), so both read the same way.
 *
 * - `GalleryHero`: a banner that turns through slides, each a drawn scene,
 *   a tag, a title, a sentence and the one button that goes there; arrows,
 *   dots, and the slide's number large and faint behind it.
 * - `GalleryChips`: a labelled row of chips that filter what is below, each
 *   with its colour's dot and a count.
 *
 * Cards and covers are the modules' own; their styles are shared under
 * `.gal-card` and `.gal-cover` in styles.css. `--h`, a hue, colours them.
 */

/** A hue for `--h`, the colour a card, a chip or a banner is drawn in. */
export const hue = (h: number) => ({ '--h': h } as CSSProperties);

export interface Slide {
  key: string;
  hue: number;
  art: ReactNode;
  icon: IconName;
  tag: string;
  title: string;
  text: string;
  go: string;
  to: () => void;
  /**
   * Right to left, the scene is mirrored so the picture keeps to the far side
   * of the words. A picture that would read wrong mirrored — a play button
   * pointing backwards — sets this false and shifts itself instead.
   */
  mirror?: boolean;
}

export function GalleryHero({ slides, label, prev, next }: { slides: Slide[]; label: string; prev: string; next: string }) {
  const [at, setAt] = useState(0);
  const i = Math.min(at, slides.length - 1);
  const slide = slides[i];
  if (!slide) return null;
  return (
    <section className={`gal-hero${slide.mirror === false ? ' no-mirror' : ''}`} style={hue(slide.hue)} aria-roledescription="carousel" aria-label={label}>
      <span className="gal-hero-art" key={slide.key}>{slide.art}</span>
      <span className="gal-hero-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
      <div className="gal-hero-text" aria-live="polite">
        <span className="gal-hero-tag"><Icon name={slide.icon} size={11} />{slide.tag}</span>
        <h2>{slide.title}</h2>
        <p>{slide.text}</p>
        <button type="button" className="gal-hero-go" onClick={slide.to}>
          {slide.go}<Icon name="chevron" size={12} className="gal-flip" />
        </button>
      </div>
      <button type="button" className="gal-hero-arrow is-prev" onClick={() => setAt((i + slides.length - 1) % slides.length)}
              title={prev} aria-label={prev}><Icon name="chevron" size={16} /></button>
      <button type="button" className="gal-hero-arrow is-next" onClick={() => setAt((i + 1) % slides.length)}
              title={next} aria-label={next}><Icon name="chevron" size={16} /></button>
      <span className="gal-hero-dots">
        {slides.map((s, k) => (
          <button key={s.key} type="button" className={k === i ? 'on' : ''} onClick={() => setAt(k)} aria-label={s.title} aria-current={k === i} />
        ))}
      </span>
    </section>
  );
}

export interface Chip<K extends string> { id: K; label: string; count: number; hue?: number }

export function GalleryChips<K extends string>({ label, chips, value, onChange }: {
  label: string; chips: Chip<K>[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <div className="gal-chips" role="group" aria-label={label}>
      <span className="gal-chips-label">{label}</span>
      {chips.map((c) => (
        <button key={c.id} type="button" className={`gal-chip${value === c.id ? ' on' : ''}`} style={c.hue === undefined ? undefined : hue(c.hue)}
                onClick={() => onChange(c.id)} aria-pressed={value === c.id}>
          {c.hue !== undefined && <i />}
          {c.label}
          <small>{c.count}</small>
        </button>
      ))}
    </div>
  );
}
