import { invoke } from '@tauri-apps/api/core';
import type { DataFile, DocLang } from './research';
import { generate, type Target } from './generate';
import type { EffortBook } from './effort';
import { bytesOf, fromDocx, fromPdf, fromText, fromXlsx, inflateRaw, kindOfName, pdfPrompt, textOfBytes } from './researchdata';

/**
 * A file the researcher picked, read into text — for the data files a
 * document reports from, and for the papers a researcher's manner is learned
 * from. One reader for both, so a Word file, a PDF or Excel's "Unicode Text"
 * is read the same way wherever it is attached.
 *
 * Nothing here writes: the files come from the system's file picker, through
 * the same read commands the data files always used.
 */

/**
 * A text file, as the app reads text: UTF-8, checked and limited in Rust.
 * Excel's "Unicode Text" — the usual way to keep Arabic letters out of an
 * older Excel — is UTF-16, which that refuses as binary; it is read again as
 * bytes and decoded here, and refused only if it is not text in either.
 */
async function readText(id: string, path: string): Promise<DataFile> {
  try {
    const r = await invoke<{ name: string; text: string; bytes: number; truncated: boolean }>('read_text_attachment', { path });
    return fromText({ id, name: r.name, text: r.text, bytes: r.bytes, truncated: r.truncated });
  } catch (e) {
    const r = await invoke<{ data: string; name: string; bytes: number }>('read_any_file', { path }).catch(() => null);
    const text = r ? textOfBytes(bytesOf(r.data)) : null;
    if (!r || text === null) throw e;
    return fromText({ id, name: r.name, text, bytes: r.bytes, truncated: false });
  }
}

/**
 * One picked file as text, or `null` when it is not a kind the app can read.
 * A PDF has no text to take out here: `target`'s model transcribes it once,
 * and the transcript is what is kept. Throws what the read threw.
 */
export async function readPicked(path: string, o: { id: string; target: Target; book: EffortBook; lang: DocLang }): Promise<DataFile | null> {
  const name = path.split(/[\\/]/).pop() ?? path;
  const kind = kindOfName(name);
  if (!kind) return null;
  if (kind === 'text') return readText(o.id, path);
  if (kind === 'docx' || kind === 'xlsx') {
    const r = await invoke<{ data: string; name: string; bytes: number }>('read_any_file', { path });
    const bytes = bytesOf(r.data);
    return kind === 'docx'
      ? fromDocx({ id: o.id, name: r.name, bytes, size: r.bytes }, inflateRaw)
      : fromXlsx({ id: o.id, name: r.name, bytes, size: r.bytes }, inflateRaw);
  }
  const r = await invoke<{ data: string; name: string; bytes: number }>('read_document', { path });
  const out = await generate(o.target, {
    system: 'You transcribe documents faithfully. You add nothing and leave nothing out.',
    user: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: r.data } },
      { type: 'text', text: pdfPrompt(r.name, o.lang) },
    ],
    maxTokens: 32_000,
    efforts: o.book,
  });
  return fromPdf({ id: o.id, name: r.name, text: out.text, bytes: r.bytes, truncated: out.stopReason === 'max_tokens' });
}
