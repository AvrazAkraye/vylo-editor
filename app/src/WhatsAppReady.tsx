import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import { CATEGORIES, fillTemplate, searchTemplates } from './whatsapptemplates';
import { LIMITS, type CategoryId, type Template, type TemplateKind } from './whatsappbulktypes';

/**
 * Ready messages: the library as a picker inside step 2 (docs/WA.md — "a
 * picker, not a place").
 *
 * Category chips (a select in the 248 px column, where twenty-six chips would
 * be a wall), a search box, and cards that show the message in the language
 * it will be sent in. *Use this* does not paste the template straight into the
 * message: it opens a small form for the blanks only the sender can fill — the
 * business name (remembered), the offer, the date — and shows which `{…}` are
 * still empty, because a blank that reaches a customer reads "Get  today".
 * `{name}`, `{first_name}` and the list's own columns are left alone: those are
 * filled per person when the message is sent.
 *
 * The drawer every step-2 tool opens in lives here too (`Drawer`), because this
 * file is the leaf the others import.
 */

// ── a drawer, for the tools that open over a step ─────────────────────────

/**
 * A panel over the step, labelled, that takes the focus and gives it back.
 *
 * Escape closes it and stops there: the WhatsApp panel listens on the window
 * for Escape to leave full screen, and closing a drawer must not also throw
 * the person out of the window they were working in. Tab cycles inside it,
 * so a keyboard user cannot wander into the step underneath and type into a
 * field they cannot see.
 */
export function Drawer({ title, onClose, closeLabel, children, wide }: {
  title: string; onClose: () => void; closeLabel: string; children: ReactNode; wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const before = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const first = box.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.wa-bk-drawer-x)');
    (first ?? box.current)?.focus();
    return () => { if (before && document.contains(before)) before.focus(); };
  }, []);
  function onKey(e: ReactKeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const all = [...box.current.querySelectorAll<HTMLElement>('button, input, textarea, select, summary, [tabindex="0"]')]
      .filter((el) => !el.hasAttribute('disabled'));
    if (!all.length) return;
    const first = all[0];
    const last = all[all.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  return (
    <div className="wa-bk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={wide ? 'wa-bk-drawer is-wide' : 'wa-bk-drawer'} role="dialog" aria-modal="true"
           aria-labelledby={`${id}-t`} tabIndex={-1} onKeyDown={onKey}>
        <div className="wa-bk-drawer-head">
          <h3 id={`${id}-t`}>{title}</h3>
          <button type="button" className="wa-bk-icon wa-bk-drawer-x" onClick={onClose} title={closeLabel} aria-label={closeLabel}>
            <Icon name="close" size={13} />
          </button>
        </div>
        <div className="wa-bk-drawer-body">{children}</div>
      </div>
    </div>
  );
}

// ── placeholders ─────────────────────────────────────────────────────────

/** Filled per person by the engine; never a blank for the sender. */
export const PER_PERSON: readonly string[] = ['name', 'first_name'];

/** The placeholders a text uses, by name (`{name|fallback}` counts as `name`), in order, once each. */
export function placeholdersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<!\\)\{([^{}|\n]{1,40})(?:\|[^{}\n]*)?\}/g)) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The blanks of a template the sender fills: everything but the per-person ones and the list's own columns. */
export function toFill(tpl: Template, columns: readonly string[]): string[] {
  return tpl.vars.filter((v) => !PER_PERSON.includes(v) && !columns.includes(v));
}

/**
 * The placeholders in a message nobody will fill: not per person, not a column
 * of the list. Every one of them would be sent as nothing, so the screen says
 * so and the step does not go on until they are filled or removed.
 */
export function holesIn(text: string, columns: readonly string[]): string[] {
  return placeholdersIn(text).filter((v) => !PER_PERSON.includes(v) && !columns.includes(v));
}

/** What a placeholder is called on the form. Explicit calls so the catalogue sees every sentence. */
export function placeholderLabel(v: string, t: (s: string) => string): string {
  if (v === 'business') return t('Business name');
  if (v === 'offer') return t('The offer');
  if (v === 'price') return t('Price');
  if (v === 'old_price') return t('Old price');
  if (v === 'discount') return t('Discount');
  if (v === 'code') return t('Code');
  if (v === 'date') return t('Date');
  if (v === 'time') return t('Time');
  if (v === 'place') return t('Place');
  if (v === 'address') return t('Address');
  if (v === 'link') return t('Link');
  if (v === 'phone') return t('Phone');
  if (v === 'product') return t('Product');
  if (v === 'service') return t('Service');
  if (v === 'hours') return t('Opening hours');
  if (v === 'points') return t('Points');
  if (v === 'days') return t('Days');
  return v;
}

export function kindText(k: TemplateKind, t: (s: string) => string): string {
  if (k === 'promo') return t('Promotion');
  if (k === 'service') return t('Service message');
  return t('Greeting');
}

/** A text with its unfilled blanks marked, so the eye finds them. */
export function Holes({ text, columns }: { text: string; columns: readonly string[] }) {
  const parts = text.split(/((?<!\\)\{[^{}\n]{1,40}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{([^{}|]+)(?:\|[^{}]*)?\}$/.exec(p);
        if (m && !PER_PERSON.includes(m[1].trim()) && !columns.includes(m[1].trim())) {
          return <mark key={i} className="wa-bk-hole">{p}</mark>;
        }
        return m ? <span key={i} className="wa-bk-var">{p}</span> : p;
      })}
    </>
  );
}

// ── the picker ───────────────────────────────────────────────────────────

export interface TemplatesProps {
  t: (s: string) => string;
  lang: Lang;
  /** The language the message is written in: the cards show the template in it. */
  msgLang: Lang;
  full: boolean;
  business: string;
  onBusiness: (s: string) => void;
  columns: readonly string[];
  /** The message is not empty, so Use replaces it — said on the button. */
  replacing: boolean;
  onUse: (text: string, tpl: Template) => void;
  onClose: () => void;
}

export function TemplatesDrawer({ t, lang, msgLang, full, business, onBusiness, columns, replacing, onUse, onClose }: TemplatesProps) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | ''>('');
  const [chosen, setChosen] = useState<Template | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const found = useMemo(
    () => searchTemplates(query, msgLang, cat ? { category: cat } : {}),
    [query, msgLang, cat],
  );
  const catName = (id: CategoryId): string => CATEGORIES.find((c) => c.id === id)?.title[lang] ?? id;
  const catIcon = (id: CategoryId): string => CATEGORIES.find((c) => c.id === id)?.icon ?? 'chat';

  if (chosen) {
    const blanks = toFill(chosen, columns);
    const filled = fillTemplate(chosen, msgLang, { ...values, business }).slice(0, LIMITS.messageChars);
    const empty = holesIn(filled, columns);
    return (
      // A drawer of its own (the key), so it takes the focus as it opens: swapped inside the list's drawer, the pressed
      // *Use this* went with the list and focus fell to <body>, where the drawer's Escape no longer heard it.
      <Drawer key={`fill-${chosen.id}`} title={chosen.title[lang] || chosen.title.en} onClose={onClose} closeLabel={t('Close')} wide={full}>
        <button type="button" className="wa-bk-link" onClick={() => setChosen(null)}>
          <Icon name="chevron" size={11} turn={180} className="ic-dir" />
          {t('All ready messages')}
        </button>
        {blanks.includes('business') && (
          <label className="wa-bk-field">
            <span>{t('Business name')}</span>
            <input className="wa-bk-input" dir="auto" value={business} maxLength={LIMITS.valueChars}
                   onChange={(e) => onBusiness(e.target.value)} />
          </label>
        )}
        {blanks.filter((v) => v !== 'business').map((v) => (
          <label className="wa-bk-field" key={v}>
            <span>{placeholderLabel(v, t)}</span>
            <input className="wa-bk-input" dir="auto" value={values[v] ?? ''} maxLength={LIMITS.valueChars}
                   onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
          </label>
        ))}
        <div className="wa-bk-paper" dir="auto"><Holes text={filled} columns={columns} /></div>
        {empty.length > 0 && (
          <p className="wa-bk-warn">
            {fill(t('Still empty: {list}. Fill them in here or in the message.'), { list: empty.map((v) => `{${v}}`).join(' ') })}
          </p>
        )}
        <button type="button" className="sb-cta-go wa-bk-go" onClick={() => onUse(filled, chosen)}>
          <Icon name="check" size={13} />
          {replacing ? t('Replace my message with this') : t('Use this message')}
        </button>
      </Drawer>
    );
  }

  return (
    <Drawer key="list" title={t('Ready messages')} onClose={onClose} closeLabel={t('Close')} wide={full}>
      <div className="wa-find wa-bk-find">
        <Icon name="search" size={12} />
        <input value={query} dir="auto" spellCheck={false} placeholder={t('Search ready messages')}
               aria-label={t('Search ready messages')}
               onChange={(e) => setQuery(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
      </div>
      {full ? (
        <div className="wa-bk-chips" role="group" aria-label={t('Categories')}>
          <button type="button" className={cat === '' ? 'wa-bk-chip on' : 'wa-bk-chip'} aria-pressed={cat === ''} onClick={() => setCat('')}>
            {t('All')}
          </button>
          {CATEGORIES.map((c) => (
            <button type="button" key={c.id} className={cat === c.id ? 'wa-bk-chip on' : 'wa-bk-chip'} aria-pressed={cat === c.id}
                    onClick={() => setCat(c.id)}>
              <Icon name={c.icon} size={12} />
              {c.title[lang] || c.title.en}
            </button>
          ))}
        </div>
      ) : (
        <label className="wa-bk-field">
          <span>{t('Category')}</span>
          <select className="wa-bk-select" value={cat} onChange={(e) => setCat(CATEGORIES.find((c) => c.id === e.target.value)?.id ?? '')}>
            <option value="">{t('All')}</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title[lang] || c.title.en}</option>)}
          </select>
        </label>
      )}
      {found.length === 0 ? (
        <p className="wa-bk-empty">{query.trim() ? fill(t('Nothing matches “{q}”.'), { q: query.trim() }) : t('No ready messages here yet.')}</p>
      ) : (
        <ul className="wa-bk-cards" aria-label={t('Ready messages')}>
          {found.slice(0, 80).map((tpl) => (
            <li key={tpl.id} className="wa-bk-tpl">
              <span className="wa-bk-tpl-top">
                <Icon name={catIcon(tpl.category)} size={12} />
                <span className="wa-bk-tpl-cat">{catName(tpl.category)}</span>
                <span className={tpl.kind === 'promo' ? 'wa-bk-kind is-promo' : 'wa-bk-kind'}>{kindText(tpl.kind, t)}</span>
              </span>
              <b className="wa-bk-tpl-title">{tpl.title[lang] || tpl.title.en}</b>
              <span className="wa-bk-tpl-text" dir="auto"><Holes text={tpl.text[msgLang] || tpl.text.en} columns={columns} /></span>
              <button type="button" className="wa-bk-btn is-small" onClick={() => { setChosen(tpl); setValues({}); }}
                      aria-label={fill(t('Use “{name}”'), { name: tpl.title[lang] || tpl.title.en })}>
                {t('Use this')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
