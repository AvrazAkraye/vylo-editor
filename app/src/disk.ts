import { invoke } from '@tauri-apps/api/core';
import { noteAuthored } from './memory';
import { changed } from './docs';

/**
 * The one call in the frontend that puts bytes on disk.
 *
 * Every write is human-authored — the editor's save, an approved diff, a
 * partial accept, the memory editor — and until now each of those called
 * `apply_write` itself. This exists so that anything which has to be true of
 * *every* such write has exactly one place to be written, rather than four
 * call sites that must each remember. Today that is one thing: a memory file a
 * person just typed or approved is a file they have read, and `noteAuthored`
 * records it so the acknowledgement in `memory.ts` does not ask again about
 * text they authored themselves.
 *
 * Since the to-do list can be open in two places at once, and since the agent
 * can write a file somebody is looking at, this is also where the app says a
 * file has changed — see `docs.ts`. Same argument as `noteAuthored`: it is true
 * of every write, so it belongs at the one door rather than at each call site.
 *
 * `expectSha256` is passed straight through. `undefined` means "write it
 * regardless", which is only right where the person typing is also the person
 * whose text is on screen; everywhere else it is the guard that turns a
 * collision into a message instead of into lost work.
 */
export async function applyWrite(
  root: string,
  path: string,
  content: string,
  expectSha256?: string,
): Promise<void> {
  await invoke('apply_write', { root, path, content, expectSha256 });
  // After the write, never before: a refused write must not leave behind an
  // acknowledgement for content that is not on disk, and must not tell anything
  // watching that a file now holds text it does not hold.
  await noteAuthored(root, path, content);
  changed(path, content);
}
