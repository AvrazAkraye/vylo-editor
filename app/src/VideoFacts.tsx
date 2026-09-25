import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import { fill } from './i18n';
import { explain } from './errors';
import type { Brief, Fact, Video } from './videotypes';
import { LABELS, guessSubjects, pictureTitle, researchVideo } from './videoresearch';

/**
 * "Found on the web": what was looked up about the video's subject before its
 * storyboard was planned (videoresearch.ts), for the person to check.
 *
 * Every fact is shown with where it came from, and a switch: only the facts
 * left on reach the model the next time the storyboard is planned. The
 * pictures found are shown with their credits; a free logo is offered for the
 * brand and never put there unasked. When the guess was wrong ("UoD" as
 * Derby), the name can be corrected and looked up again — keylessly, with no
 * model asked.
 */

type T = (s: string) => string;

const KNOWN: ReadonlySet<string> = new Set(Object.values(LABELS));

/** A fact's label in the interface's language: the known ones translated, a qualifier kept — "Founded (…)". */
function labelText(label: string, t: T): string {
  const m = /^(.*?) \((.+)\)$/.exec(label);
  const base = m ? m[1] : label;
  const shown = KNOWN.has(base) ? t(base) : base;
  return m ? `${shown} (${m[2]})` : shown;
}

/** Where a fact came from, as a person reads it. */
function sourceText(source: string, t: T): string {
  const web = /^(.*) \(web search\)$/.exec(source);
  return web ? `${web[1]} · ${t('web search')}` : source;
}

const whenOf = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** A fresh lookup keeps the person's "leave it out" for a fact that is still there, word for word. */
function keepSwitches(next: Brief, prev: Brief | undefined): Brief {
  const off = new Set((prev?.facts ?? []).filter((f) => !f.use).map((f) => `${f.label}\n${f.value}`));
  return off.size ? { ...next, facts: next.facts.map((f) => (off.has(`${f.label}\n${f.value}`) ? { ...f, use: false } : f)) } : next;
}

export function VideoFacts({ t, video, onChange, locked, onError }: {
  t: T;
  video: Video;
  onChange: (next: Partial<Video>) => void;
  locked: boolean;
  onError: (m: string) => void;
}): JSX.Element | null {
  const brief = video.brief;
  const [name, setName] = useState(() => brief?.subjects?.[0] ?? guessSubjects(video.request)[0]?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [missed, setMissed] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const open = (url: string) => {
    if (!/^https:\/\//.test(url)) return;
    void invoke('open_url', { url }).catch((e: unknown) => onError(explain(e, t('open that link'))));
  };

  const lookUp = async () => {
    const n = name.trim();
    if (!n || busy || locked) return;
    const c = new AbortController();
    ctl.current?.abort();
    ctl.current = c;
    setBusy(true);
    setMissed(null);
    try {
      const next = await researchVideo(video.request, { lang: video.lang, format: video.format, subjects: [{ name: n }], signal: c.signal });
      if (c.signal.aborted) return;
      if (!next.facts.length && !next.pictures.length) { setMissed(n); return; }
      onChange({ brief: keepSwitches(next, brief), lookup: true });
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') onError(explain(e, t('look it up')));
    } finally {
      if (ctl.current === c) { ctl.current = null; setBusy(false); }
    }
  };

  const setFacts = (facts: Fact[]) => brief && onChange({ brief: { ...brief, facts } });
  const toggle = (i: number, use: boolean) => brief && setFacts(brief.facts.map((f, j) => (j === i ? { ...f, use } : f)));
  const removePicture = (i: number) => brief && onChange({ brief: { ...brief, pictures: brief.pictures.filter((_, j) => j !== i) } });

  const facts = brief?.facts ?? [];
  const summaryAt = facts.findIndex((f) => f.label === LABELS.summary);
  const summary = summaryAt >= 0 ? facts[summaryAt] : null;
  const listed = facts.map((f, i) => ({ f, i })).filter(({ i }) => i !== summaryAt);
  const on = facts.filter((f) => f.use).length;
  const logo = brief?.logo;
  const logoInUse = !!logo && video.brand?.logo === logo.src;

  const again = (
    <div className="vid-facts-again">
      <label className="vid-facts-name">
        <span>{brief ? t('Not what you meant? Name it and look it up again') : t('Name what the video is about')}</span>
        <span className="vid-facts-search">
          <input value={name} dir="auto" disabled={busy || locked} placeholder={t('For example: University of Duhok')}
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookUp(); } }} />
          <button type="button" className="ghost bordered" disabled={!name.trim() || busy || locked} onClick={() => void lookUp()}>
            {busy ? <span className="vid-spinner" aria-hidden="true" /> : <Icon name="search" size={12} />}
            {busy ? t('Looking it up…') : brief ? t('Look it up again') : t('Look it up')}
          </button>
          {busy && (
            <button type="button" className="ghost" onClick={() => ctl.current?.abort()}>{t('Stop')}</button>
          )}
        </span>
      </label>
      {missed && <p className="vid-bad" dir="auto">{fill(t('Nothing was found for “{name}”. Try its full name, in English.'), { name: missed })}</p>}
    </div>
  );

  if (!brief) {
    return (
      <div className="vid-facts">
        <div className="vid-facts-card">
          <div className="vid-facts-head">
            <span className="vid-facts-glyph" aria-hidden="true"><Icon name="search" size={15} /></span>
            <span className="vid-facts-what">
              <b>{video.lookup === false ? t('This video was planned without looking anything up') : t('Nothing has been looked up for this video yet')}</b>
              <span>{t('Look up an organisation, a place or a person: real facts, photographs and a logo from Wikipedia, Wikidata and Wikimedia Commons.')}</span>
            </span>
          </div>
          <div className="vid-facts-body">{again}</div>
        </div>
        <p className="vid-note vid-pad">{t('What is found is used when the storyboard is planned again (Details → Plan the storyboard again).')}</p>
      </div>
    );
  }

  return (
    <div className="vid-facts">
      <div className="vid-facts-card">
        <div className="vid-facts-head">
          <span className="vid-facts-glyph" aria-hidden="true"><Icon name="search" size={15} /></span>
          <span className="vid-facts-what">
            <b dir="auto">{brief.subjects.length ? brief.subjects.join(' · ') : t('The request names nothing specific to look up')}</b>
            <span>
              {fill(t('Looked up {when}'), { when: whenOf(brief.at) })}
              {' · '}{fill(t('{n} of {of} facts go to the model'), { n: on, of: facts.length })}
              {' · '}{fill(t('{n} pictures'), { n: brief.pictures.length })}
            </span>
          </span>
        </div>

        {summary && (
          <div className={`vid-facts-body vid-facts-summary ${summary.use ? '' : 'is-off'}`}>
            <div className="vid-facts-row">
              <span className="vid-facts-label"><Icon name="book" size={11} />{t('Summary')}</span>
              <label className="vid-facts-switch" title={summary.use ? t('Used — press to leave it out') : t('Left out — press to use it')}>
                <input type="checkbox" role="switch" checked={summary.use} disabled={locked} aria-label={t('Use the summary')}
                       onChange={(e) => toggle(summaryAt, e.target.checked)} />
                <i />
              </label>
            </div>
            <p dir="auto">{summary.value}</p>
            <button type="button" className="vid-facts-src" onClick={() => open(summary.url)} title={summary.url}>
              <Icon name="link" size={10} />{sourceText(summary.source, t)}
            </button>
          </div>
        )}

        {listed.length > 0 && (
          <div className="vid-facts-body">
            <span className="vid-group-label">{t('Facts')}</span>
            <ul className="vid-facts-list">
              {listed.map(({ f, i }) => (
                <li key={`${i}-${f.label}`} className={f.use ? '' : 'is-off'}>
                  <span className="vid-facts-fact">
                    <span className="vid-facts-label">{labelText(f.label, t)}</span>
                    <span className="vid-facts-value" dir="auto">{f.value}</span>
                    <button type="button" className="vid-facts-src" onClick={() => open(f.url)} title={f.url}>
                      <Icon name="link" size={10} />{sourceText(f.source, t)}
                    </button>
                  </span>
                  <label className="vid-facts-switch" title={f.use ? t('Used — press to leave it out') : t('Left out — press to use it')}>
                    <input type="checkbox" role="switch" checked={f.use} disabled={locked}
                           aria-label={fill(t('Use “{what}”'), { what: labelText(f.label, t) })}
                           onChange={(e) => toggle(i, e.target.checked)} />
                    <i />
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="vid-facts-body">
          <span className="vid-group-label">{t('Logo')}</span>
          {logo
            ? (
              <div className="vid-facts-logo">
                <img src={logo.src} alt="" />
                <span className="vid-facts-what">
                  <span dir="auto">{logo.credit}</span>
                  {logoInUse && <b className="vid-facts-ok"><Icon name="check" size={11} />{t('In use as the brand’s logo')}</b>}
                </span>
                {!logoInUse && (
                  <button type="button" className="ghost bordered" disabled={locked}
                          onClick={() => onChange({ brand: { ...video.brand, logo: logo.src } })}>
                    {video.brand?.logo ? t('Use this logo instead') : t('Use this logo')}
                  </button>
                )}
              </div>
            )
            : <p className="vid-note">{t('No free logo was found — a Wikipedia’s own logo is usually “fair use”, which a video may not reuse. Add yours under Look → Brand.')}</p>}
        </div>

        <div className="vid-facts-body">
          <span className="vid-group-label">{fill(t('Pictures found ({n})'), { n: brief.pictures.length })}</span>
          {brief.pictures.length
            ? (
              <ul className="vid-facts-pics">
                {brief.pictures.map((p, i) => (
                  <li key={`${i}-${p.source}`}>
                    <figure>
                      <img src={p.src} alt={pictureTitle(p)} loading="lazy" />
                      <button type="button" className="vid-facts-drop" disabled={locked} onClick={() => removePicture(i)}
                              title={t('Remove this picture')} aria-label={t('Remove this picture')}>
                        <Icon name="close" size={10} />
                      </button>
                      <figcaption dir="auto" title={p.credit}>{p.credit}</figcaption>
                    </figure>
                  </li>
                ))}
              </ul>
            )
            : <p className="vid-note">{t('No reusable pictures of it were found. The scenes get openly licensed stock pictures instead.')}</p>}
          {brief.pictures.length > 0 && <p className="vid-note">{t('These go into the scenes that take a picture before any stock search. Openly licensed (CC0, public domain, CC BY or CC BY-SA) and credited at the end.')}</p>}
        </div>

        <div className="vid-facts-body">{again}</div>
      </div>

      <p className="vid-facts-warn vid-pad">
        <Icon name="warning" size={12} />
        <span>{t('From Wikipedia, Wikidata and Wikimedia Commons (and the model’s web search, when the route allows it). They can be wrong or out of date: check each fact, and switch off any you are not sure of. Changes are used when the storyboard is planned again (Details → Plan the storyboard again).')}</span>
      </p>
    </div>
  );
}
