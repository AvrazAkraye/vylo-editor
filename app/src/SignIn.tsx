import { useState } from 'react';
import { checkKey, type KeyCheck } from './gateway';
import { login, mintKey, register, type Failure } from './account';
import { hostOs } from './environment';

/**
 * How this app gets a key, which is the first thing it needs and the first
 * thing the first screen asks for.
 *
 * There are two routes and this file holds both, because they are one decision
 * — *how do I get a key* — rather than two features that happen to sit near
 * each other:
 *
 *   `SignIn`    email and password, and the app mints its own key. The default.
 *   `KeySetup`  paste an `sk-vylo-…` key. One disclosure away.
 *
 * The pasted key is kept, not replaced. Not everyone reaching this screen has
 * an account on this gateway — a self-hosted one may not run the account API at
 * all — and taking the paste field away would lock those people out of an app
 * that works for them today. It is the *second* option now, not a deleted one.
 *
 * ## The password does not leave this file
 *
 * It is in one component's state, it is sent once, and it is cleared the moment
 * the request returns — before the result is even looked at, so the error paths
 * cannot reach it either. It is not in a ref, not in `localStorage`, not passed
 * up through `onSignedIn`, and not in anything rendered here.
 *
 * It is also cleared on the way to the paste field, which is the one exit from
 * this form that does **not** unmount the component: switching to `paste`
 * swaps what is rendered and leaves the state behind it, so without that the
 * password of somebody who started typing, thought better of it and pasted a
 * key instead would sit in memory for the rest of the session. Everywhere else
 * the component goes away with it — a finished setup sets `apiKey`, and
 * `Welcome` stops rendering this the moment there is one.
 *
 * ## The key is shown once and never again
 *
 * `POST /keys` returns it and the server keeps only a hash, so it is handed
 * straight up to be stored at the moment it arrives. There is no screen to show
 * it on, because there would be nothing to put on that screen a second time.
 *
 * ## Two secrets, and neither is the other
 *
 * The token authenticates the account API; the key authenticates the model API.
 * Nothing here sends one where the other belongs — `account.ts` builds no URL
 * outside `/app/api`, `gateway.ts` builds none outside `/v1/`, and this file
 * builds none at all.
 */

/**
 * What the minted key is called on the account's key list.
 *
 * The point of a name is that someone looking at that list on the website can
 * tell one device from another and revoke the right one. A hostname would be
 * the best answer and the webview cannot see one: there is no OS plugin in this
 * app's dependencies and reading the machine name would take a new Tauri
 * command, which is a new name to keep out of the tool schema for a label. So
 * this says what the user agent already knows — the app and the platform —
 * which separates a Mac from a Windows machine, and the server's own creation
 * date separates two of the same.
 *
 * Deliberately not translated. It is stored on a server and read back on a web
 * page in whoever's language, so it is data, not interface.
 */
function deviceName(): string {
  const os = hostOs();
  return `Vylo Editor on ${os === 'macos' ? 'Mac' : os === 'windows' ? 'Windows' : 'Linux'}`;
}

/**
 * The one thing needed, when it is the only thing needed.
 *
 * Without a key you could open a folder, read the code, type a question, and
 * only then be told to go to Settings. Asking here costs one screen and saves
 * that. It does not *block* opening a folder, because the editor and the
 * terminal work perfectly well without a key and someone may only want those.
 *
 * `said` is the sign-in that got half way: signed in, but the key could not be
 * minted. It is rendered here rather than left on the previous screen because
 * this *is* the next thing to do, and a person dropped onto a paste field with
 * no explanation would reasonably think the sign-in had failed.
 *
 * `onBack` is offered in both cases, and in the half-way one it is the retry:
 * signing in again mints again, which is the whole remedy for a mint that
 * failed on a bad minute rather than on a bad account.
 */
function KeySetup({ baseUrl, onKey, onBack, said, t }: {
  baseUrl: string;
  onKey: (k: string) => void;
  onBack: () => void;
  said?: Failure | null;
  t: (s: string) => string;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeyCheck | null>(null);

  async function connect() {
    setBusy(true);
    setResult(null);
    const r = await checkKey(baseUrl, key);
    setResult(r);
    setBusy(false);
    // A key that is right but blocked — no plan, suspended, rate limited — is
    // still the right key, so it is saved. Only a rejected one is withheld.
    if (r.state === 'ok' || r.state === 'ok-but' || r.state === 'unknown') onKey(key.trim());
  }

  return (
    <section className="wc-key">
      <h2>{t('Connect to your gateway')}</h2>
      <p className="wc-key-note">
        {t('Vylo Editor talks to your own gateway. Paste the key from your account to let the agent answer.')}
      </p>
      {said && (
        <div className="wc-key-fell">
          {t('You are signed in, but this app could not make a key for itself.')}
          {' '}{t(said.note)} {t(said.fix)}
          {/* The server's own words, untranslated, exactly as the sign-in form
              shows them. It is the half that says which rule was broken. */}
          {said.detail && <p className="wc-key-detail">{said.detail}</p>}
        </div>
      )}
      <div className="wc-key-row">
        <input
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setResult(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) void connect(); }}
          placeholder="sk-vylo-…"
          spellCheck={false}
          autoFocus
        />
        <button className="approve" onClick={() => void connect()} disabled={busy || !key.trim()}>
          {busy ? t('Checking…') : t('Connect')}
        </button>
      </div>
      {result && result.state !== 'ok' && (
        <p className={`wc-key-said ${result.state === 'bad' ? 'bad' : ''}`}>
          {result.note} {result.fix}
        </p>
      )}
      {result?.state === 'ok' && <p className="wc-key-said good">{t('Connected.')}</p>}
      <div className="wc-acc-act">
        <button className="wc-acc-alt" onClick={onBack}>{t('Sign in instead')}</button>
      </div>
    </section>
  );
}

interface Props {
  baseUrl: string;
  /**
   * A finished setup: the session token, and the key to talk to the model with.
   *
   * Either half may be empty, and both cases are real. `token` is `''` when a
   * key was pasted rather than minted — that person has no account here and
   * does not need one. `key` is `''` when the sign-in worked and the minting
   * did not: they *are* signed in, the plan balance is theirs to see, and the
   * only thing missing is the key. Neither empty string may overwrite something
   * that is already set.
   *
   * The password is deliberately not here. It never leaves this file.
   */
  onSignedIn: (token: string, key: string) => void;
  t: (s: string) => string;
}

/** Sign in, create an account, or paste a key. Registering is the same form. */
export function SignIn({ baseUrl, onSignedIn, t }: Props) {
  const [mode, setMode] = useState<'signin' | 'register' | 'paste'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'' | 'auth' | 'key'>('');
  const [why, setWhy] = useState<Failure | null>(null);

  async function go() {
    setWhy(null);
    setStep('auth');
    const r = mode === 'register'
      ? await register(baseUrl, email, password)
      : await login(baseUrl, email, password);
    // Dropped at the only moment it stops being needed. Nothing below this
    // line can reach it, including every error path.
    setPassword('');
    if (!r.ok) { setWhy(r.why); setStep(''); return; }

    setStep('key');
    const k = await mintKey(baseUrl, r.value.token, deviceName());
    setStep('');
    if (!k.ok) {
      // Half a success, and the half that worked is kept. The token is handed
      // up regardless: this person is signed in, `/me` will answer for them,
      // and throwing the session away to report a key problem would make them
      // type a password again for no reason. The paste field is the way on.
      onSignedIn(r.value.token, '');
      setWhy(k.why);
      setMode('paste');
      return;
    }
    onSignedIn(r.value.token, k.value);
  }

  if (mode === 'paste') {
    return (
      <KeySetup baseUrl={baseUrl} onKey={(k) => onSignedIn('', k)} said={why} t={t}
                onBack={() => { setWhy(null); setMode('signin'); }} />
    );
  }

  // Enough to be worth sending, not a validator. The server owns what a valid
  // address is, says so precisely, and its answer is what gets shown.
  const ready = /.@./.test(email) && password.length > 0 && !step;
  return (
    <section className="wc-key">
      <h2>{t('Sign in to Vylo')}</h2>
      <p className="wc-key-note">
        {t('Sign in with your Vylo account and this app will make its own key. Your password is sent once and never stored.')}
      </p>
      <div className="wc-acc-rows">
        <input type="email" value={email} autoFocus spellCheck={false}
               placeholder={t('Email')} autoComplete="username"
               onChange={(e) => { setEmail(e.target.value); setWhy(null); }} />
        <input type="password" value={password}
               placeholder={t('Password')}
               autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
               onChange={(e) => { setPassword(e.target.value); setWhy(null); }}
               onKeyDown={(e) => { if (e.key === 'Enter' && ready) void go(); }} />
      </div>
      <div className="wc-acc-act">
        <button className="approve" onClick={() => void go()} disabled={!ready}>
          {step === 'key' ? t('Making a key…')
            : step ? (mode === 'register' ? t('Creating your account…') : t('Signing in…'))
              : mode === 'register' ? t('Create an account') : t('Sign in')}
        </button>
        <button className="wc-acc-alt"
                onClick={() => { setMode(mode === 'register' ? 'signin' : 'register'); setWhy(null); }}>
          {mode === 'register' ? t('Already have an account? Sign in') : t('New here? Create an account')}
        </button>
        {/* Leaving the form rather than submitting it, so the password goes
            here too: `paste` swaps what is rendered without unmounting this,
            and half a typed password would otherwise outlive the field it was
            typed into. */}
        <button className="wc-acc-alt"
                onClick={() => { setWhy(null); setPassword(''); setMode('paste'); }}>
          {t('Paste a key instead')}
        </button>
      </div>
      {why && (
        <>
          {/* Only the two a person can fix by typing are red. A suspended
              account and a server having a bad minute are not the user's
              mistake and should not be coloured as one. */}
          <p className={`wc-key-said ${why.state === 'wrong-password' || why.state === 'taken' ? 'bad' : ''}`}>
            {t(why.note)} {t(why.fix)}
          </p>
          {/* Whatever came off the wire: the server's own validation message, a
              status number, an address. Untranslated on purpose — it is not
              ours to word. */}
          {why.detail && <p className="wc-key-detail">{why.detail}</p>}
        </>
      )}
    </section>
  );
}
