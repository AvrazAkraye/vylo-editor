import { useState } from 'react';
import { Icon } from './Icon';
import { GalleryChips, GalleryHero, hue, type Slide } from './Gallery';
import { fill } from './i18n';
import { KINDS, type Doc, type Kind } from './research';
import { GROUP, HUE, KindArt, SCENE_HUE, SceneArt, type Group } from './ResearchArt';

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
    <button type="button" className={`gal-card${on ? ' on' : ''}${compact ? ' is-compact' : ''}`} style={hue(HUE[kind])} onClick={() => onPick(kind)}>
      <span className="gal-card-art">
        <KindArt kind={kind} />
        <span className="gal-badge"><i />{badgeName(g, t)}</span>
        {!!count && <span className="gal-count" title={t('Your documents')}><Icon name="file" size={10} />{count}</span>}
        <b className="gal-card-name">{names.kind(kind)}</b>
      </span>
      <span className="gal-card-body">
        <span className="gal-card-about">{names.about(kind)}</span>
        <span className="rsch-says">{names.samples(kind).map((p) => <code key={p} dir="auto">{p}</code>)}</span>
      </span>
    </button>
  );
}

export function ResearchHome({ t, docs, people, names, onOpen, onPick, onTab }: {
  t: T;
  docs: Doc[];
  people: number;
  names: Names;
  onOpen: (id: string) => void;
  onPick: (k: Kind) => void;
  onTab: (where: Where) => void;
}) {
  const [group, setGroup] = useState<Group | 'all'>('all');
  const latest = docs.find((d) => d.sections.some((s) => s.state === 'done')) ?? docs[0];
  const slides: Slide[] = [
    { key: 'write', hue: SCENE_HUE.write, art: <SceneArt scene="write" />, tag: t('Write'), title: t('Theses, papers and dissertations'), icon: 'pencil',
      text: t('Name what you need — in Arabic, Kurdish or English — and it is planned, sourced and written, with footnotes and a reference list.'),
      go: t('Start writing'), to: () => onTab('write') },
    { key: 'voice', hue: SCENE_HUE.voice, art: <SceneArt scene="voice" />, tag: t('Researchers'), title: t('Write in a researcher’s style'), icon: 'person',
      text: people
        ? fill(t('{n} researchers saved. Any document can be written in the manner of one of them.'), { n: people })
        : t('Save a researcher and their papers; any document can then be written in their manner.'),
      go: t('Open Researchers'), to: () => onTab('people') },
    { key: 'check', hue: SCENE_HUE.check, art: <SceneArt scene="check" />, tag: t('Originality'), title: t('Check originality'), icon: 'shield',
      text: t('Compare a document with its sources, your other work and the catalogues, and fix what is too close.'),
      go: t('Check a document'), to: () => onTab('check') },
    { key: 'chat', hue: SCENE_HUE.chat, art: <SceneArt scene="chat" />, tag: t('Chat'), title: t('Talk to your research'), icon: 'chat',
      text: t('Ask your latest document what it argues, or tell it what to change.'),
      go: latest ? t('Open the latest document') : t('Start writing'), to: () => (latest ? onOpen(latest.id) : onTab('write')) },
  ];
  const count = (k: Kind) => docs.filter((d) => d.kind === k).length;
  const kinds = KINDS.filter((k) => group === 'all' || GROUP[k.id] === group);

  return (
    <div className="gal-home">
      <GalleryHero slides={slides} label={t('Research')} prev={t('Previous')} next={t('Next')} />

      <div className="gal-head">
        <h3>{t('What do you need?')} <small>{fill(t('{n} kinds of document'), { n: KINDS.length })}</small></h3>
        <p>{t('Each kind of document is a skill. Name it in your request — in Arabic, Kurdish or English — and it switches on.')}</p>
      </div>
      <GalleryChips label={t('Kinds')} value={group} onChange={setGroup}
                    chips={(['all', 'paper', 'thesis', 'plan'] as const).map((g) => ({
                      id: g, label: groupName(g, t), hue: g === 'all' ? undefined : GROUP_HUE[g],
                      count: g === 'all' ? KINDS.length : KINDS.filter((k) => GROUP[k.id] === g).length,
                    }))} />
      <div className="gal-grid">
        {kinds.map((k) => <SkillCard key={k.id} kind={k.id} t={t} names={names} onPick={onPick} count={count(k.id)} />)}
      </div>

      {docs.length > 0 && (
        <>
          <div className="gal-head">
            <h3>{t('Your documents')} <small>{docs.length}</small></h3>
          </div>
          <div className="gal-covers">
            {docs.map((d) => (
              <button key={d.id} type="button" className="gal-cover" style={hue(HUE[d.kind])} onClick={() => onOpen(d.id)}>
                <span className="gal-cover-art">
                  <span className="gal-cover-page" dir={d.lang === 'en' ? 'ltr' : 'rtl'}>
                    <small>{names.kind(d.kind)}</small>
                    <b>{d.meta.title || d.request}</b>
                    <i /><i /><i />
                  </span>
                  <span className="gal-badge"><i />{badgeName(GROUP[d.kind], t)}</span>
                  {d.voice && <span className="gal-cover-mark" title={fill(t('In the style of {name}'), { name: d.voice.name })}><Icon name="person" size={10} /></span>}
                </span>
                <span className="gal-cover-foot">
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
