import { useState, type CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';
import { fill } from './i18n';
import { KINDS, type Doc, type Kind } from './research';
import { GROUP, HUE, KindArt, SCENE_HUE, SceneArt, type Group, type Scene } from './ResearchArt';

/**
 * Research's home in the full window, before a document is open: a gallery.
 *
 * A banner that turns through what the module does — write a thesis, write
 * in a researcher's manner, check originality, talk to a document — each with
 * the button that goes there; chips that filter the kinds of document by
 * group; a card for each kind with its picture, its colour and the phrases
 * that ask for it; and the documents so far as covers.
 *
 * Everything here is navigation: it opens tabs and documents and chooses a
 * skill. The pictures are ResearchArt.tsx's own drawings.
 */

type T = (s: string) => string;
type Where = 'write' | 'people' | 'check';

interface Names {
  kind: (k: Kind) => string;
  about: (k: Kind) => string;
  samples: (k: Kind) => string[];
  /** A document's state in words: "Finished", "5 of 18 written", the stage it is at. */
  status: (d: Doc) => string;
  when: (at: number) => string;
  live: (d: Doc) => boolean;
}

const hue = (h: number) => ({ '--h': h } as CSSProperties);

function groupName(g: Group | 'all', t: T): string {
  if (g === 'paper') return t('Papers');
  if (g === 'thesis') return t('Theses');
  if (g === 'plan') return t('Reviews and plans');
  return t('All');
}

function badgeName(g: Group, t: T): string {
  if (g === 'paper') return t('Paper');
  if (g === 'thesis') return t('Thesis');
  return t('Review or plan');
}

const GROUP_HUE: Readonly<Record<Group, number>> = { paper: 217, thesis: 239, plan: 172 };

/** A card for a kind of document: its picture and colour, what it is, the words that ask for it. */
export function SkillCard({ kind, t, names, on, onPick, count, compact }: {
  kind: Kind; t: T; names: Names; on?: boolean; onPick: (k: Kind) => void; count?: number; compact?: boolean;
}) {
  const g = GROUP[kind];
  return (
    <button type="button" className={`rsch-skill-card${on ? ' on' : ''}${compact ? ' is-compact' : ''}`} style={hue(HUE[kind])} onClick={() => onPick(kind)}>
      <span className="rsch-skill-art">
        <KindArt kind={kind} />
        <span className="rsch-badge-dot"><i />{badgeName(g, t)}</span>
        {!!count && <span className="rsch-skill-count" title={t('Your documents')}><Icon name="file" size={10} />{count}</span>}
        <b className="rsch-skill-name">{names.kind(kind)}</b>
      </span>
      <span className="rsch-skill-body">
        <span className="rsch-skill-about">{names.about(kind)}</span>
        <span className="rsch-says">{names.samples(kind).map((p) => <code key={p} dir="auto">{p}</code>)}</span>
      </span>
    </button>
  );
}

interface Slide { scene: Scene; tag: string; title: string; text: string; go: string; icon: IconName; to: () => void }

export function ResearchHome({ t, docs, people, names, onOpen, onPick, onTab }: {
  t: T;
  docs: Doc[];
  people: number;
  names: Names;
  onOpen: (id: string) => void;
  onPick: (k: Kind) => void;
  onTab: (where: Where) => void;
}) {
  const [at, setAt] = useState(0);
  const [group, setGroup] = useState<Group | 'all'>('all');
  const latest = docs.find((d) => d.sections.some((s) => s.state === 'done')) ?? docs[0];
  const slides: Slide[] = [
    { scene: 'write', tag: t('Write'), title: t('Theses, papers and dissertations'), icon: 'pencil',
      text: t('Name what you need — in Arabic, Kurdish or English — and it is planned, sourced and written, with footnotes and a reference list.'),
      go: t('Start writing'), to: () => onTab('write') },
    { scene: 'voice', tag: t('Researchers'), title: t('Write in a researcher’s style'), icon: 'person',
      text: people
        ? fill(t('{n} researchers saved. Any document can be written in the manner of one of them.'), { n: people })
        : t('Save a researcher and their papers; any document can then be written in their manner.'),
      go: t('Open Researchers'), to: () => onTab('people') },
    { scene: 'check', tag: t('Originality'), title: t('Check originality'), icon: 'shield',
      text: t('Compare a document with its sources, your other work and the catalogues, and fix what is too close.'),
      go: t('Check a document'), to: () => onTab('check') },
    { scene: 'chat', tag: t('Chat'), title: t('Talk to your research'), icon: 'chat',
      text: t('Ask your latest document what it argues, or tell it what to change.'),
      go: latest ? t('Open the latest document') : t('Start writing'), to: () => (latest ? onOpen(latest.id) : onTab('write')) },
  ];
  const slide = slides[at];
  const count = (k: Kind) => docs.filter((d) => d.kind === k).length;
  const kinds = KINDS.filter((k) => group === 'all' || GROUP[k.id] === group);

  return (
    <div className="rsch-home">
      <section className="rsch-hero" style={hue(SCENE_HUE[slide.scene])} aria-roledescription="carousel" aria-label={t('Research')}>
        <span className="rsch-hero-art" key={slide.scene}><SceneArt scene={slide.scene} /></span>
        <span className="rsch-hero-num" aria-hidden="true">{String(at + 1).padStart(2, '0')}</span>
        <div className="rsch-hero-text" aria-live="polite">
          <span className="rsch-hero-tag"><Icon name={slide.icon} size={11} />{slide.tag}</span>
          <h2>{slide.title}</h2>
          <p>{slide.text}</p>
          <button type="button" className="rsch-hero-go" onClick={slide.to}>
            {slide.go}<Icon name="chevron" size={12} className="rsch-flip" />
          </button>
        </div>
        <button type="button" className="rsch-hero-arrow is-prev" onClick={() => setAt((at + slides.length - 1) % slides.length)}
                title={t('Previous')} aria-label={t('Previous')}><Icon name="chevron" size={16} /></button>
        <button type="button" className="rsch-hero-arrow is-next" onClick={() => setAt((at + 1) % slides.length)}
                title={t('Next')} aria-label={t('Next')}><Icon name="chevron" size={16} /></button>
        <span className="rsch-hero-dots">
          {slides.map((s, i) => (
            <button key={s.scene} type="button" className={i === at ? 'on' : ''} onClick={() => setAt(i)} aria-label={s.title} aria-current={i === at} />
          ))}
        </span>
      </section>

      <div className="rsch-home-head">
        <h3>{t('What do you need?')} <small>{fill(t('{n} kinds of document'), { n: KINDS.length })}</small></h3>
        <p>{t('Each kind of document is a skill. Name it in your request — in Arabic, Kurdish or English — and it switches on.')}</p>
      </div>
      <div className="rsch-chiprow" role="group" aria-label={t('Kinds')}>
        <span className="rsch-chiprow-label">{t('Kinds')}</span>
        {(['all', 'paper', 'thesis', 'plan'] as const).map((g) => (
          <button key={g} type="button" className={`rsch-gchip${group === g ? ' on' : ''}`} style={g === 'all' ? undefined : hue(GROUP_HUE[g])}
                  onClick={() => setGroup(g)} aria-pressed={group === g}>
            {g !== 'all' && <i />}
            {groupName(g, t)}
            <small>{g === 'all' ? KINDS.length : KINDS.filter((k) => GROUP[k.id] === g).length}</small>
          </button>
        ))}
      </div>
      <div className="rsch-skill-grid">
        {kinds.map((k) => <SkillCard key={k.id} kind={k.id} t={t} names={names} onPick={onPick} count={count(k.id)} />)}
      </div>

      {docs.length > 0 && (
        <>
          <div className="rsch-home-head">
            <h3>{t('Your documents')} <small>{docs.length}</small></h3>
          </div>
          <div className="rsch-cover-grid">
            {docs.map((d) => (
              <button key={d.id} type="button" className="rsch-cover" style={hue(HUE[d.kind])} onClick={() => onOpen(d.id)}>
                <span className="rsch-cover-art">
                  <span className="rsch-cover-page" dir={d.lang === 'en' ? 'ltr' : 'rtl'}>
                    <small>{names.kind(d.kind)}</small>
                    <b>{d.meta.title || d.request}</b>
                    <i /><i /><i />
                  </span>
                  <span className="rsch-badge-dot"><i />{badgeName(GROUP[d.kind], t)}</span>
                  {d.voice && <span className="rsch-cover-voice" title={fill(t('In the style of {name}'), { name: d.voice.name })}><Icon name="person" size={10} /></span>}
                </span>
                <span className="rsch-cover-foot">
                  <span className={`rsch-dot ${names.live(d) ? 'is-live' : d.stage === 'done' ? 'is-done' : d.error ? 'is-bad' : ''}`} aria-hidden="true" />
                  <span>{names.status(d)}</span>
                  <small>{names.when(d.updated)}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
