// The Tauri command layer, stood up in Node against a real temp folder.
//
// ## What this is and is not
//
// It is NOT a test of the Rust side. `src-tauri` has its own suite and that is
// where `list_tree`, `search`, containment and the stale-write guard are
// actually proved. This exists so the *frontend* half of each of those
// contracts can be exercised: that `runAgent` routes `read_file` through the
// staging area, that `Pending.apply` states the version it built a change on,
// that a declined command never reaches `run_command` at all. Read every
// assertion in `e2e.test.mjs` as being about the caller, never the callee.
//
// It works because `invoke` in `@tauri-apps/api/core` is one line —
// `window.__TAURI_INTERNALS__.invoke(cmd, args)` — read at call time. Filling
// that in is enough to run the real `agent.ts` and the real `pending.ts`
// unmodified, which is the whole reason to prefer it over a hand-written stub
// of `Pending`: a fake staging area would agree with itself.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Where a relative path lands, refused if it leaves the folder.
 *
 * A copy of the rule Rust enforces, not evidence for it. It is here so that a
 * mistake in a test — or a scenario that hands the loop `../../etc/hosts` to
 * see what it does — cannot write outside the temp directory this file made.
 */
function resolve(root, rel) {
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`${rel}: outside the open folder`);
  return full;
}

function walk(dir, root = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out.sort();
}

/**
 * Every file in the folder and what is in it.
 *
 * Taken either side of a turn, this is how "nothing was written" is asserted:
 * comparing one named file would miss a write anywhere else, and the claim
 * being made is about the whole folder.
 */
export function snapshot(root) {
  const out = {};
  for (const rel of walk(root)) out[rel] = fs.readFileSync(path.join(root, rel), 'utf8');
  return out;
}

/**
 * A real folder with real files in it, plus the command layer wired to it.
 *
 * `calls` is every command the frontend reached for, in order — which is how
 * the absence of one is asserted. `run` overrides what `run_command` answers
 * with; it never spawns anything. Nothing here opens a pty: VYLO.md records
 * that a test which read one to EOF wedged Windows CI for hours, and the
 * approval gate is a frontend decision that a real shell would not make
 * more true.
 */
export async function openFolder(files) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'vylo-e2e-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = resolve(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, content, 'utf8');
  }

  const calls = [];
  const folder = {
    root,
    calls,
    /** What `run_command` answers with. Replaced per scenario. */
    run: () => ({ code: 0, stdout: '', stderr: '', timed_out: false, truncated: false }),
    names: () => calls.map((c) => c.cmd),
    reached: (cmd) => calls.some((c) => c.cmd === cmd),
    of: (cmd) => calls.filter((c) => c.cmd === cmd).map((c) => c.args),
    snapshot: () => snapshot(root),
    read: (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
    write: (rel, content) => fs.writeFileSync(path.join(root, rel), content, 'utf8'),
    async remove() { await fsp.rm(root, { recursive: true, force: true, maxRetries: 5 }); },
  };

  const commands = {
    read_file: ({ root: r, path: p }) => fs.readFileSync(resolve(r, p), 'utf8'),

    list_tree: ({ root: r, maxEntries }) => {
      const all = walk(r);
      const cap = maxEntries ?? 2000;
      return { entries: all.slice(0, cap).map((p) => ({ path: p, dir: false })), skipped: 0, truncated: all.length > cap };
    },

    search: ({ root: r, query, maxHits }) => {
      const hits = [];
      for (const rel of walk(r)) {
        fs.readFileSync(path.join(r, rel), 'utf8').split('\n').forEach((text, i) => {
          if (text.includes(query)) hits.push({ path: rel, line: i + 1, text });
        });
      }
      return { hits: hits.slice(0, maxHits ?? 200), skipped: 0, truncated: false };
    },

    find_symbol: ({ root: r, name }) => {
      const out = [];
      for (const rel of walk(r)) {
        fs.readFileSync(path.join(r, rel), 'utf8').split('\n').forEach((text, i) => {
          const m = /^\s*(?:export\s+)?(?:function|const|class|struct|type)\s+([A-Za-z_]\w*)/.exec(text);
          if (m && m[1].toLowerCase().includes(name.toLowerCase())) out.push({ name: m[1], path: rel, line: i + 1, kind: 'function' });
        });
      }
      return out;
    },

    // The one command in the frontend that puts bytes on disk. It refuses a
    // write whose stated version is not what is there, exactly as `lib.rs`
    // does, so that a test can watch the frontend supply the hash rather than
    // take its word for it.
    apply_write: ({ root: r, path: p, content, expectSha256 }) => {
      const full = resolve(r, p);
      if (expectSha256 !== undefined && expectSha256 !== null) {
        const actual = fs.existsSync(full) ? sha256(fs.readFileSync(full, 'utf8')) : null;
        const matches = actual === null ? expectSha256 === '' : actual === expectSha256;
        if (!matches) {
          throw new Error(`${p} changed on disk since this was prepared, so it was not written. Reload the file and try again.`);
        }
      }
      fs.writeFileSync(full, content, 'utf8');
      return null;
    },

    run_command: (args) => folder.run(args),
  };

  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, args });
        const fn = commands[cmd];
        // Anything not listed above is a command the frontend should not be
        // reaching from here. Naming it beats a silent undefined.
        if (!fn) throw new Error(`no command '${cmd}' in the e2e harness`);
        return fn(args ?? {});
      },
    },
  };

  return folder;
}

/** localStorage in four lines. `limits.ts` and `memory.ts` reach for the global. */
export function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  return map;
}
