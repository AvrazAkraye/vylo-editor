/**
 * Turning a git remote into a link somebody can open.
 *
 * ## No token, deliberately
 *
 * "Connect to GitHub" usually means a personal access token, an OAuth flow, and
 * a second credential in an app that has spent a lot of effort having only one.
 * A token that can open pull requests can also read every private repository
 * the person owns, and it would have to live somewhere on disk.
 *
 * None of that is needed for the things people actually want. A pull request is
 * a page on github.com with the fields already filled in; opening it in a
 * browser gets the whole feature with no credential, no API surface, and
 * nothing to leak. The browser is already signed in, which is the part a token
 * would have been duplicating.
 *
 * So this file builds URLs and nothing else. It makes no requests.
 *
 * ## Why parsing a remote is worth a module
 *
 * A remote can be written five ways and three of them are not URLs. The
 * scp-like form — `git@github.com:owner/repo.git` — has a colon where a URL
 * would have a slash, so `new URL()` reads the whole thing as the `git` scheme
 * and hands back nonsense rather than throwing. Getting this wrong produces a
 * link that looks right and 404s, which is worse than no link.
 */

export interface Remote {
  host: string;
  owner: string;
  repo: string;
  /** Only GitHub gets links: every other host writes its paths differently. */
  isGitHub: boolean;
}

/** `git@host:owner/repo(.git)` — a remote that is not a URL. */
const SCP = /^(?:([^@/]+)@)?([^:/@]+):(.+)$/;

/**
 * Read a remote.
 *
 * Returns null for anything it cannot be sure of, and being sure is the point:
 * a wrong answer here is a link that opens somebody else's repository.
 */
export function parseRemote(url: string): Remote | null {
  const raw = (url ?? '').trim();
  if (!raw) return null;

  let host = '';
  let path = '';

  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(raw);
  if (scheme) {
    // ssh://, https://, git://, and http:// from an old checkout.
    try {
      const u = new URL(raw);
      host = u.hostname;
      path = u.pathname;
    } catch {
      return null;
    }
  } else {
    const m = SCP.exec(raw);
    if (!m) return null;
    host = m[2];
    path = m[3];
  }

  // `owner/repo`, with `.git` and any surrounding slashes taken off. GitHub
  // repositories are always exactly two segments; anything else is a host that
  // organises them differently, and guessing at it is how you get a 404.
  const bits = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/').filter(Boolean);
  if (bits.length !== 2) return null;
  const [owner, repo] = bits;
  if (!owner || !repo || !host) return null;

  return { host, owner, repo, isGitHub: isGitHubHost(host) };
}

/**
 * github.com, or an Enterprise install.
 *
 * `endsWith('github.com')` alone would accept `notgithub.com`, and a host
 * merely *containing* "github" would accept `github.evil.example`. Both are
 * how a link ends up somewhere else entirely.
 */
export function isGitHubHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'github.com' || h.endsWith('.github.com')
    || h === 'github' || h.startsWith('github.');
}

/** The repository's page. */
export const repoUrl = (r: Remote): string => `https://${r.host}/${r.owner}/${r.repo}`;

/**
 * A file, on a branch, optionally at a line.
 *
 * The path is encoded segment by segment: `encodeURIComponent` on the whole
 * thing would turn every `/` into `%2F` and give one long filename.
 */
export function blobUrl(r: Remote, branch: string, path: string, line?: number): string {
  const where = path.split('/').map(encodeURIComponent).join('/');
  const at = line && line > 0 ? `#L${line}` : '';
  return `${repoUrl(r)}/blob/${encodeURIComponent(branch)}/${where}${at}`;
}

/** One commit. */
export const commitUrl = (r: Remote, hash: string): string =>
  `${repoUrl(r)}/commit/${encodeURIComponent(hash)}`;

/**
 * The page that opens a pull request, with the form already filled in.
 *
 * `expand=1` is what turns GitHub's compare page into the pull request form
 * rather than a diff with a button on it — one fewer click, and the difference
 * between "it opened the thing" and "it opened near the thing".
 */
export function compareUrl(r: Remote, base: string, head: string): string {
  return `${repoUrl(r)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
}

/** The repository's pull requests. */
export const pullsUrl = (r: Remote): string => `${repoUrl(r)}/pulls`;

/**
 * Whether a URL is safe to hand to the operating system's opener.
 *
 * Only `https`. `file:` opens anything on the disk, `javascript:` is obvious,
 * and on Windows the shell will happily act on schemes nobody here has heard
 * of. The Rust side checks this too — this one is so the UI can grey a button
 * rather than offering something that will be refused.
 */
export function isOpenable(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
