import { useState } from 'react';
import { Icon } from './Icon';
import * as ask from './ask';
import {
  acceptableBase, newId, normalizeBase, type Provider, type Wire,
} from './providers';

/**
 * The providers a person has added, and the form that adds one.
 *
 * Small on purpose. A provider is four facts — a name, a URL, which dialect
 * the URL speaks, a key — plus the model ids to offer in the composer. Models
 * are typed, never fetched: a request that fires because a settings page
 * opened is a request nobody asked for, and the person adding a key knows
 * which models it can use.
 *
 * The key is shown masked and is only ever sent to the URL beside it — the
 * rule providers.ts exists for.
 */

interface Props {
  providers: Provider[];
  onChange: (next: Provider[]) => void;
  t: (s: string) => string;
}

const BLANK = { name: '', baseUrl: '', wire: 'openai' as Wire, key: '', models: '' };

export function ProviderList({ providers, onChange, t }: Props) {
  const [form, setForm] = useState<typeof BLANK | null>(null);
  /** The provider being edited, or '' for a new one. */
  const [editing, setEditing] = useState('');
  const [bad, setBad] = useState('');

  function open(p?: Provider) {
    setBad('');
    setEditing(p?.id ?? '');
    setForm(p
      ? { name: p.name, baseUrl: p.baseUrl, wire: p.wire, key: p.key, models: p.models.join(', ') }
      : { ...BLANK });
  }

  function saveForm() {
    if (!form) return;
    const baseUrl = normalizeBase(form.baseUrl);
    if (!acceptableBase(baseUrl)) {
      // The one error worth explaining inline: everything else on the form is
      // free text, but a URL this app will not talk to needs to say why.
      setBad(t('Use an https address, or http on localhost.'));
      return;
    }
    if (!form.key.trim() && !baseUrl.startsWith('http://')) {
      setBad(t('A key is needed. Local servers are the exception.'));
      return;
    }
    const models = [...new Set(form.models.split(/[,\n]/).map((m) => m.trim()).filter(Boolean))];
    const record: Provider = {
      id: editing || newId(providers.map((p) => p.id)),
      name: form.name.trim() || baseUrlHost(baseUrl),
      baseUrl,
      wire: form.wire,
      key: form.key.trim(),
      models,
    };
    onChange(editing
      ? providers.map((p) => (p.id === editing ? record : p))
      : [...providers, record]);
    setForm(null);
  }

  return (
    <div className="pv">
      {providers.length === 0 && !form && (
        <p className="set-val">{t('None yet. The gateway is always available.')}</p>
      )}

      {providers.map((p) => (
        <div key={p.id} className="pv-row">
          <div className="pv-what">
            <b>{p.name}</b>
            <span className="mono">{baseUrlHost(p.baseUrl)}</span>
            <span>{p.wire === 'openai' ? t('OpenAI-compatible') : t('Anthropic-compatible')}
              {' · '}{p.models.length} {p.models.length === 1 ? t('model') : t('models')}</span>
          </div>
          <button className="ghost" onClick={() => open(p)}>{t('Edit')}</button>
          <button className="ghost" onClick={() => void (async () => {
            if (await ask.confirm({
              title: t('Remove this provider?'),
              body: `${p.name} — ${t('its key is removed with it')}`,
              confirmLabel: t('Remove'), danger: true,
            })) onChange(providers.filter((x) => x.id !== p.id));
          })()}>{t('Remove')}</button>
        </div>
      ))}

      {form ? (
        <div className="pv-form">
          <label>{t('Name')}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                   placeholder="OpenAI" spellCheck={false} />
          </label>
          <label>{t('Address')}
            <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                   placeholder="https://api.openai.com/v1" spellCheck={false} className="mono" />
          </label>
          <label>{t('What it speaks')}
            <select value={form.wire} onChange={(e) => setForm({ ...form, wire: e.target.value as Wire })}>
              {/* Named by the dialect, not by the company: Blackbox and an
                  Ollama on this machine are both the first option. */}
              <option value="openai">{t('OpenAI-compatible — most providers')}</option>
              <option value="anthropic">{t('Anthropic-compatible')}</option>
            </select>
          </label>
          <label>{t('API key')}
            <input type="password" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}
                   placeholder="sk-…" spellCheck={false} className="mono" />
          </label>
          <label>{t('Models, separated by commas')}
            <input value={form.models} onChange={(e) => setForm({ ...form, models: e.target.value })}
                   placeholder="gpt-4o, gpt-4o-mini" spellCheck={false} className="mono" />
          </label>
          {bad && <p className="pv-bad">{bad}</p>}
          <div className="pv-acts">
            <button className="ghost" onClick={() => setForm(null)}>{t('Cancel')}</button>
            <button className="approve" onClick={saveForm}>{t('Save')}</button>
          </div>
        </div>
      ) : (
        <button className="ghost bordered" onClick={() => open()}>
          <Icon name="plus" size={13} />{t('Add a provider')}
        </button>
      )}
    </div>
  );
}

/** The host, for a row that should not shout a whole URL. */
function baseUrlHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export default ProviderList;
