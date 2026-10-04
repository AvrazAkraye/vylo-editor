/**
 * Which files the editor must not try to read as text.
 *
 * A folder holds PDFs, pictures and archives beside the code, and the explorer lets a person click any of them.
 * The text editor asked the disk for their text, got "not valid UTF-8 (binary?)" and the app printed that as a
 * red error line in the chat — once per tab, and again for every restored tab on the next launch. A binary file
 * is not a failure: it is a file this pane is not for. So the name decides, before anything is read, and the
 * pane says what the file is and what can be done with it.
 *
 * By name only, deliberately: asking the disk first is the read that failed. A text file with a binary
 * extension (a `.pdf` that is really text) is rare, and the person can still drag it into the chat.
 */
export type BinaryKind = 'pdf' | 'image' | 'audio' | 'video' | 'archive' | 'office' | 'font' | 'binary';

const BY_EXT: Record<string, BinaryKind> = {
  pdf: 'pdf',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image', bmp: 'image',
  tif: 'image', tiff: 'image', ico: 'image', icns: 'image', psd: 'image', raw: 'image', avif: 'image',
  mp3: 'audio', m4a: 'audio', wav: 'audio', aac: 'audio', flac: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio', aiff: 'audio', amr: 'audio',
  mp4: 'video', mov: 'video', m4v: 'video', mkv: 'video', avi: 'video', webm: 'video', wmv: 'video', '3gp': 'video',
  zip: 'archive', gz: 'archive', tgz: 'archive', tar: 'archive', rar: 'archive', '7z': 'archive', bz2: 'archive', xz: 'archive', dmg: 'archive', iso: 'archive',
  doc: 'office', docx: 'office', xls: 'office', xlsx: 'office', ppt: 'office', pptx: 'office', pages: 'office', numbers: 'office', key: 'office', odt: 'office', ods: 'office', odp: 'office',
  ttf: 'font', otf: 'font', woff: 'font', woff2: 'font', eot: 'font',
  exe: 'binary', dll: 'binary', so: 'binary', dylib: 'binary', bin: 'binary', o: 'binary', a: 'binary', class: 'binary', jar: 'binary',
  wasm: 'binary', pyc: 'binary', sqlite: 'binary', sqlite3: 'binary', db: 'binary', pkg: 'binary', apk: 'binary', ipa: 'binary',
  sketch: 'binary', fig: 'binary', blend: 'binary', mdb: 'binary',
};

/** The kind of binary file a path names, or null when it may be text (or has no extension we know). */
export function binaryKind(path: string): BinaryKind | null {
  const name = String(path ?? '').split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null; // `.gitignore` and `Makefile` are text
  return BY_EXT[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** What to call it, as an English phrase for the catalogue. */
export const KIND_LABEL: Readonly<Record<BinaryKind, string>> = {
  pdf: 'PDF document',
  image: 'Picture',
  audio: 'Audio file',
  video: 'Video file',
  archive: 'Archive',
  office: 'Office document',
  font: 'Font file',
  binary: 'Binary file',
};

/** A folder's file as a full path, in the separator the folder itself uses. */
export function fullPath(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  const tail = String(rel).replace(/^[\\/]+/, '').split(/[\\/]+/).join(sep);
  return `${base}${sep}${tail}`;
}
