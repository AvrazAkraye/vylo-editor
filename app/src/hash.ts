/**
 * The one digest in the frontend.
 *
 * Two things are keyed on it and both fail quietly when they disagree: the
 * stale-write guard (`expect_sha256`, compared against a hash Rust computed)
 * and the project-memory acknowledgement (the text a human accepted, compared
 * against the text now on disk). A second copy that differed in encoding or in
 * hex case would show up as a write refused for no reason, or as an approval
 * silently inherited by sentences nobody read.
 */

/** Lowercase hex sha-256, matching what the Rust side computes. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
