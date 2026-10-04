/**
 * "Run the app for me": telling a server from a command, and where its address opens.
 *
 * A command the agent runs either finishes (`npm test`, `git status`) or does not: a dev server runs until it is
 * stopped. The two need different handling. A command that finishes is waited for and its output goes back to
 * the model. A server waited for in the same way blocks the turn for as long as it lives — in a pipe it was killed
 * after two minutes with the page never opened, in the terminal the agent waited forever. So a command that
 * *looks like a server* is run in the terminal pane (the same approved string, on a surface you can watch and
 * stop), the agent is told as soon as its address appears, and the address is opened for the person.
 *
 * `isServerCommand` is deliberately a list of the common starters and not a guess: a false positive only moves
 * a command to the terminal and answers early with what it printed, and a miss leaves things as they were.
 *
 * Where it opens is the person's choice (Settings → Editor): Chrome, the default browser, or nowhere. Chrome is
 * the default because that is what was asked for; a machine without Chrome falls back to the default browser
 * (`open_local` in devenv.rs), and only addresses on this machine are ever opened (the same rule browser.ts
 * applies to the dev-server pane).
 */
export type OpenIn = 'chrome' | 'default' | 'off';

export const OPEN_KEY = 'vylo.devopen.v1';
export const OPEN_CHOICES: readonly OpenIn[] = ['chrome', 'default', 'off'];

/** A stored choice read back: anything unrecognised is the default, Chrome. */
export function readOpenIn(raw: unknown): OpenIn {
  return typeof raw === 'string' && (OPEN_CHOICES as readonly string[]).includes(raw) ? (raw as OpenIn) : 'chrome';
}

/** How long a server command may run before the agent is told it is still going (ms). */
export const SERVER_QUIET_MS = 45_000;
/** How long after its address first appears the output is collected before the agent is told (ms). */
export const SERVER_SETTLE_MS = 1_500;

const SERVERS: readonly RegExp[] = [
  // package scripts: npm start, npm run dev, pnpm dev, yarn web, bun run serve ...
  /^(?:npm|pnpm|yarn|bun)(?: run)? (?:start|dev|serve|web|develop|preview|storybook|watch)(?::[\w-]+)?(?: |$)/,
  /^(?:npx |bunx |pnpm dlx |yarn dlx )?expo (?:start|run:web)\b/,
  /^(?:npx |bunx |pnpm exec |yarn )?(?:vite(?: dev| preview| serve)?|next dev|nuxt dev|nuxi dev|astro (?:dev|preview)|remix (?:dev|vite:dev)|ng serve|gatsby develop|webpack serve|webpack-dev-server|parcel(?: serve)?|serve|http-server|live-server|browser-sync(?: start)?|json-server|react-scripts start|vue-cli-service serve|svelte-kit dev|sirv|storybook dev)(?: |$)/,
  /^(?:python3?|py) -m (?:http\.server|flask run|uvicorn|streamlit run|gradio)\b/,
  /^(?:python3?|py) [\w./-]*manage\.py runserver\b/,
  /^(?:flask run|uvicorn|gunicorn|hypercorn|fastapi (?:dev|run)|streamlit run|jupyter (?:lab|notebook)|rails (?:s|server)|php -s|hugo (?:server|serve)|jekyll serve|bundle exec jekyll serve|mkdocs serve|bin\/dev|cargo (?:leptos |trunk )?watch|trunk serve|deno task (?:dev|start|serve)|bundle exec rails s(?:erver)?)(?: |$)/,
];

/** Strip what only sets the scene: `cd x`, `export A=b`, `A=b cmd`, `source f`, `nvm use`. */
function stripSetup(segment: string): string {
  let s = segment.trim();
  for (;;) {
    const before = s;
    s = s.replace(/^(?:export |set )?[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*) +/, '');
    if (s === before) break;
  }
  return s;
}

/**
 * Output that says a server is up although it printed no address on this machine. Expo's Metro, started without
 * the web target, prints `exp://192.168…` and a list of keys (`Press w │ open web`) and nothing a browser can open;
 * without this the agent would wait out the whole quiet period to learn that.
 */
export function isUp(text: string): boolean {
  return typeof text === 'string' && /\bMetro waiting on\b|\bpress w\s*[│|]\s*open web\b/i.test(text);
}

/** Whether the command starts something that keeps running (a dev server), as opposed to something that ends. */
export function isServerCommand(command: string): boolean {
  if (typeof command !== 'string' || !command.trim() || command.length > 4000) return false;
  const segments = command.toLowerCase().replace(/\s+/g, ' ').split(/ ?(?:&&|\|\||;|\n|\|) ?/);
  return segments.some((raw) => {
    const s = stripSetup(raw);
    if (!s || /^(?:cd|export|source|\.|nvm|echo|set|unset|alias) /.test(s) || s === 'cd') return false;
    // A one-shot build or install is not a server, whatever follows the verb.
    if (/^(?:npm|pnpm|yarn|bun)(?: run)? (?:build|test|lint|install|i|ci|add|remove|publish|pack)\b/.test(s)) return false;
    // The same tools with a verb that ends: `vite build`, `next build`, `expo export`.
    if (/^(?:npx |bunx |pnpm exec |yarn )?(?:vite|next|nuxt|nuxi|astro|remix|ng|gatsby|webpack|parcel|expo|storybook|react-scripts|vue-cli-service) (?:build|export|lint|test|generate|info|--version|-v|--help|-h)\b/.test(s)) return false;
    return SERVERS.some((re) => re.test(s));
  });
}
