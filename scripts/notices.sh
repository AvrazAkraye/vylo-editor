#!/usr/bin/env bash
#
# Regenerates THIRD_PARTY_NOTICES.md from what npm and cargo already know.
#
# Why this exists: MIT, BSD and Apache-2.0 all require the copyright notice and
# the licence text to travel with a distribution. Vylo ships a binary, so the
# notices have to ship with it, and a hand-written list of several hundred
# packages is a list that is wrong the first time a dependency is bumped.
#
# One licence in this tree asks for more than a notice. MPL-2.0 section 3.2
# requires a distributor of the Executable Form to tell each recipient how to
# obtain the Source Code Form, and reproducing the licence text does not do
# that. So the renderer below emits a separate section naming, per MPL-2.0
# package, where its published source can be had. Nothing else here has an
# obligation this file's shape does not already discharge -- if a licence with
# one arrives (LGPL, EPL, CDDL), it needs the same treatment and will not get it
# by accident.
#
# Why it is not `license-checker` or `cargo-about`: everything below reads
# `npm ls --json` and `cargo metadata --format-version 1`, which are stable,
# already installed, and cannot themselves rot. A tool would be a fourth thing
# to keep current in a file whose whole point is not going stale.
#
# Usage:
#   scripts/notices.sh          rewrite THIRD_PARTY_NOTICES.md
#   scripts/notices.sh --check  exit 1 if the committed file is out of date
#
# EXIT CODES, because a gate calls this and the two failures are not the same
# kind of thing:
#
#   0  the file is current (or was rewritten)
#   1  the file is STALE -- a real finding, and the committer's to fix
#   3  the inputs could not be gathered here -- npm, cargo or node missing,
#      node_modules not installed, or `cargo metadata --offline` unable to
#      resolve a target whose crates this machine has never fetched. Nothing is
#      known about the file either way. `gate.sh` reports this and carries on:
#      a hook that goes red for a reason the committer did not cause is a hook
#      that gets deleted.
#
# The output is deterministic -- no timestamp, sorted everywhere -- so --check
# is a real gate: identical inputs produce a byte-identical file.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
APP="$ROOT/app"
TAURI="$APP/src-tauri"
OUT="$ROOT/THIRD_PARTY_NOTICES.md"

# The targets a release is actually built for. macOS Intel is here because the
# CI matrix keeps it one uncomment away (see .github/workflows), and a notice
# file that has to be regenerated to re-enable a target is a trap.
TARGETS="aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc"

CHECK=0
if [ "${1:-}" = "--check" ]; then CHECK=1; fi

command -v npm   >/dev/null || { echo "notices: npm not found" >&2; exit 3; }
command -v cargo >/dev/null || { echo "notices: cargo not found" >&2; exit 3; }
command -v node  >/dev/null || { echo "notices: node not found" >&2; exit 3; }
[ -d "$APP/node_modules" ] || { echo "notices: $APP/node_modules missing -- run 'npm ci' in app/ first" >&2; exit 3; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- collect -----------------------------------------------------------------
# npm: production closure only. devDependencies (vite, typescript, the Tauri
# CLI) build the app; they are not in it, so they are not distributed and do not
# need a notice. `npm ls` exits non-zero on extraneous/peer complaints that do
# not affect the tree, so the JSON is validated instead of the exit code.
( cd "$APP" && npm ls --all --long --json --omit=dev >"$WORK/npm.json" 2>"$WORK/npm.err" ) || true
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).dependencies||process.exit(1)' \
  "$WORK/npm.json" || { echo "notices: 'npm ls' produced no dependency tree" >&2; cat "$WORK/npm.err" >&2; exit 3; }

# cargo: once per shipped target, so a crate compiled only on Windows is still
# listed. --offline keeps this reproducible without the network; drop it if the
# lockfile has moved and the registry has not been fetched yet.
METAS=""
for t in $TARGETS; do
  ( cd "$TAURI" && cargo metadata --format-version 1 --offline --filter-platform "$t" >"$WORK/cargo-$t.json" ) \
    || { echo "notices: cargo metadata failed for $t -- this machine may never have fetched that target's crates ('cargo fetch --target $t')" >&2; exit 3; }
  METAS="$METAS $WORK/cargo-$t.json"
done

# --- render ------------------------------------------------------------------
cat >"$WORK/notices.mjs" <<'NODE_EOF'
import fs from 'node:fs';
import path from 'node:path';

const [npmJson, appPkgPath, cargoTomlPath, ...metaFiles] = process.argv.slice(2);

// --- licence text classification --------------------------------------------
// Ordered: the first predicate that matches wins, so the narrow forms come
// before the ones they are a superset of (MIT-0 before MIT, BSD-3 before BSD-2).
// A file that matches nothing is left unclassified rather than guessed at -- a
// notices file that attributes the wrong licence text is worse than one that
// admits it did not find the text.
// Every predicate is anchored on a phrase that only the *body* of the licence
// contains, never on its name. Half the crates in this tree ship a COPYRIGHT
// or COPYING file that names two licences and contains neither, and matching
// "Apache License, Version 2.0" would file that pointer under Apache-2.0 and
// then reproduce it as the Apache text. `rustix`'s COPYRIGHT did exactly that
// before these tests were tightened.
const APACHE_BODY = t => /Version 2\.0, January 2004/.test(t)
  && /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/i.test(t);

const CLASSIFIERS = [
  ['Apache-2.0 WITH LLVM-exception', t => APACHE_BODY(t) && /LLVM Exception/i.test(t)],
  ['Apache-2.0', t => APACHE_BODY(t)],
  ['MPL-2.0', t => /Mozilla Public License Version 2\.0/i.test(t) && /Covered Software/i.test(t)],
  ['Unicode-3.0', t => /UNICODE LICENSE V3/i.test(t) && /COPYRIGHT AND PERMISSION NOTICE/i.test(t)],
  ['CC0-1.0', t => /CC0 1\.0 Universal/i.test(t) && /Copyright and Related Rights/i.test(t)],
  ['Unlicense', t => /This is free and unencumbered software released into the public domain/i.test(t) && /Anyone is free to copy, modify, publish/i.test(t)],
  ['Zlib', t => /This software is provided ['\u2018\u2019]as-is['\u2018\u2019], without any express or implied/i.test(t) && /altered source versions must be plainly marked/i.test(t)],
  ['BSD-3-Clause', t => /Redistribution and use in source and binary forms/i.test(t) && /(Neither the name|names of its contributors may be used to endorse)/i.test(t)],
  ['BSD-2-Clause', t => /Redistribution and use in source and binary forms/i.test(t)],
  ['ISC', t => /Permission to use, copy, modify, and(\/or)? distribute this software/i.test(t) && /copyright notice and this permission notice appear in all copies/i.test(t)],
  ['0BSD', t => /Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted\./i.test(t)],
  ['MIT-0', t => /Permission is hereby granted, free of charge/i.test(t) && !/above copyright notice and this permission notice/i.test(t)],
  ['MIT', t => /Permission is hereby granted, free of charge/i.test(t) && /above copyright notice and this permission notice/i.test(t)],
];

// Tested against the text with every whitespace run collapsed to one space,
// because these files are hard-wrapped at whatever column their author liked
// and a phrase that has to match cannot be allowed to depend on that.
function classify(text) {
  const flat = text.replace(/\s+/g, ' ');
  for (const [id, test] of CLASSIFIERS) { try { if (test(flat)) return id; } catch { /* ignore */ } }
  return null;
}

// A licence file is the crate's own licence. A file named NOTICE or
// THIRD-PARTY is somebody else's, carried inside it, and is reported
// separately rather than folded into the totals.
const LICENCE_FILE = /^(LICEN[SC]E|COPYING|COPYRIGHT|UNLICENSE)/i;
const FOREIGN_FILE = /^NOTICE|THIRD[-_. ]?PARTY/i;

function licenceFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return { own: [], foreign: [] }; }
  const stat = n => { try { return fs.statSync(path.join(dir, n)).isFile(); } catch { return false; } };
  return {
    own: names.filter(n => LICENCE_FILE.test(n) && !FOREIGN_FILE.test(n) && stat(n)).sort(),
    foreign: names.filter(n => FOREIGN_FILE.test(n)).sort(),
  };
}

function readCapped(p) {
  try {
    if (fs.statSync(p).size > 400000) return null;
    return fs.readFileSync(p, 'utf8');
  } catch { return null; }
}

// --- copyright lines ---------------------------------------------------------
// Apache-2.0's appendix carries a *template* copyright line; reproducing
// "Copyright [yyyy] [name of copyright owner]" as if it named someone would be
// a fabricated attribution.
const TEMPLATE = /\[yyyy\]|\[name of copyright owner\]|<year>|<name of author>|\{\{|YEAR.*AUTHOR|\bxxxx\b/i;

// A real notice is `Copyright` followed by (c), the symbol, or a year -- not
// the word `copyright` where it happens to begin a wrapped line of the
// Apache-2.0 body ("copyright license to reproduce, prepare Derivative
// Works of,"). Requiring what comes after it is what separates the two.
const NOTICE = /^(?:Copyright\s*(?:\((?:c|C)\)|\u00a9|\d{4})|\(c\)\s*\d|\u00a9\s*\d)/;

function copyrightLines(texts) {
  const out = [];
  const add = line => {
    if (TEMPLATE.test(line)) return;
    if (line.length < 10 || line.length > 200) return;
    if (!out.includes(line)) out.push(line);
  };
  for (const t of texts) {
    for (const raw of t.replace(/\r\n/g, '\n').split('\n')) {
      const line = raw.trim().replace(/^[#*/\-\s]+/, '').trim();
      // An SPDX document states the notice in a field rather than a sentence.
      const spdx = line.match(/^PackageCopyrightText:\s*(.+?)\s*$/);
      if (spdx) { add('Copyright ' + spdx[1].replace(/^<text>/, '').trim()); continue; }
      if (NOTICE.test(line)) add(line);
    }
  }
  return out;
}

// --- SPDX expression tidying -------------------------------------------------
// `MIT/Apache-2.0` is the pre-SPDX spelling of `MIT OR Apache-2.0`, and
// `Apache-2.0 OR MIT` is the same grant as `MIT OR Apache-2.0`. Sorting the
// terms of a pure disjunction collapses those into one heading without
// changing what any of them mean. Anything with AND, WITH or parentheses is
// left exactly as the package declared it.
function tidyExpr(expr) {
  if (!expr) return null;
  let e = expr.replace(/\s*\/\s*/g, ' OR ').replace(/\s+/g, ' ').trim();
  if (/\bAND\b|\bWITH\b|[()]/.test(e)) return e;
  const terms = e.split(/\s+OR\s+/i).map(s => s.trim()).filter(Boolean);
  if (terms.length < 2) return e;
  return [...new Set(terms)].sort((a, b) => a.localeCompare(b)).join(' OR ');
}

function idsIn(expr) {
  return (expr || '').split(/\s+(?:OR|AND)\s+|\s*\/\s*/i)
    .map(s => s.replace(/[()]/g, '').trim()).filter(Boolean);
}

// --- gather packages ---------------------------------------------------------
const packages = [];          // {eco, name, version, expr, dir, files}
const foreignNotices = [];    // packages carrying somebody else's notices

// npm: flatten the `npm ls --long` tree. Deduped children can repeat with less
// information, so the richest record for each name@version wins.
{
  const tree = JSON.parse(fs.readFileSync(npmJson, 'utf8'));
  const seen = new Map();
  (function rec(node) {
    for (const [name, info] of Object.entries(node.dependencies || {})) {
      const key = `${name}@${info.version}`;
      const prev = seen.get(key);
      if (!prev || (!prev.path && info.path)) seen.set(key, { name, version: info.version, license: info.license, path: info.path });
      rec(info);
    }
  })(tree);

  for (const p of [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = p.path || path.join(path.dirname(appPkgPath), 'node_modules', p.name);
    let expr = p.license;
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* ignore */ }
    if (!expr && manifest) {
      // The 2013-era shapes: `license: {type}` and `licenses: [{type}]`.
      expr = typeof manifest.license === 'string'
        ? manifest.license
        : (manifest.license && manifest.license.type)
          || (Array.isArray(manifest.licenses)
                ? manifest.licenses.map(x => x && x.type).filter(Boolean).join(' OR ')
                : null);
    }
    packages.push({ eco: 'npm', name: p.name, version: p.version, expr, dir, manifest });
  }
}

// cargo: union of the resolve graph across every shipped target, following
// only normal dependency edges. dev-dependencies never reach the binary;
// build-dependencies run at build time and are not distributed either.
{
  const byId = new Map();
  const wanted = new Set();
  for (const f of metaFiles) {
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const p of m.packages) byId.set(p.id, p);
    const nodes = new Map(m.resolve.nodes.map(n => [n.id, n]));
    const seen = new Set();
    const queue = [m.resolve.root];
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const n = nodes.get(id);
      if (!n) continue;
      for (const d of n.deps) {
        if ((d.dep_kinds || []).some(k => (k.kind || 'normal') === 'normal')) queue.push(d.pkg);
      }
    }
    seen.delete(m.resolve.root);
    for (const id of seen) wanted.add(id);
  }
  const crates = [...wanted].map(id => byId.get(id)).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  for (const c of crates) {
    packages.push({ eco: 'cargo', name: c.name, version: c.version, expr: c.license, dir: path.dirname(c.manifest_path), meta: c });
  }
}

// --- read each package's licence files ---------------------------------------
const texts = new Map();   // spdx id -> Map(normalized body -> {text, count, from})
const noFile = [];
const unclassified = [];

function normalise(t) {
  return t.replace(/\r\n/g, '\n').split('\n')
    .filter(l => !/^\s*(Copyright|\(c\)|\u00a9|SPDX-|Portions? Copyright)/i.test(l))
    .join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().toLowerCase();
}

for (const p of packages) {
  const { own, foreign } = licenceFiles(p.dir);
  if (foreign.length) foreignNotices.push({ ...p, foreign });
  p.texts = [];
  for (const name of own) {
    const t = readCapped(path.join(p.dir, name));
    if (t === null) continue;
    p.texts.push({ name, text: t, id: classify(t) });
  }
  p.copyright = copyrightLines(p.texts.map(t => t.text));
  if (!p.copyright.length) {
    // Fall back to the package's own declared authorship. This is weaker than a
    // copyright line and is labelled as such in the output.
    const a = p.eco === 'cargo'
      ? (p.meta?.authors || [])
      : [p.manifest?.author, ...(p.manifest?.contributors || [])]
          .map(x => (typeof x === 'string' ? x : x && x.name)).filter(Boolean);
    p.authors = [...new Set(a)].filter(Boolean);
  }
  if (!own.length) noFile.push(p);
  for (const t of p.texts) {
    if (!t.id) { unclassified.push(`${p.name}@${p.version} (${t.name})`); continue; }
    if (!texts.has(t.id)) texts.set(t.id, new Map());
    const key = normalise(t.text);
    const bucket = texts.get(t.id);
    if (!bucket.has(key)) bucket.set(key, { text: t.text, count: 0, from: `${p.name} ${p.version} (${t.name})` });
    bucket.get(key).count++;
  }
}

// --- output ------------------------------------------------------------------
const appVersion = JSON.parse(fs.readFileSync(appPkgPath, 'utf8')).version;
const cargoVersion = (fs.readFileSync(cargoTomlPath, 'utf8').match(/^version\s*=\s*"([^"]+)"/m) || [])[1] || '?';

const npmPkgs = packages.filter(p => p.eco === 'npm');
const cargoPkgs = packages.filter(p => p.eco === 'cargo');
const out = [];
const w = s => out.push(s);

w('# Third-party notices');
w('');
w('Vylo Editor is distributed as a binary built from the packages listed below,');
w('each used under the licence named against it. MIT, BSD and Apache-2.0 all');
w('require the copyright notice and the licence text to travel with a');
w('distribution; this file is how they travel.');
w('');
w('MPL-2.0 asks for one thing more — section 3.2 requires that a recipient of');
w('the binary be told how to obtain the source of the covered components — and');
w('*Source for MPL-2.0 components* below is that notice.');
w('');
w('The list is deliberately over-inclusive. It is every package npm and cargo');
w('resolve as a non-development dependency of the app, which sweeps in a few');
w('that are only ever used while building — a proc-macro crate and its own');
w('dependencies run on the build machine and do not end up in the binary.');
w('Naming a package that does not ship costs a line; omitting one that does is');
w('the failure this file exists to prevent.');
w('');
w('**This file is generated. Do not edit it by hand.** Run `scripts/notices.sh`');
w('to rebuild it, or `scripts/notices.sh --check` to fail when it is out of date.');
w('The output is deterministic and carries no timestamp, so an unchanged');
w('dependency tree regenerates a byte-identical file.');
w('');
w(`Generated for **Vylo Editor ${appVersion}** (Rust crate \`vylo-editor\` ${cargoVersion}).`);
w('');
w('## What is covered');
w('');
w('| Ecosystem | Source of truth | Scope | Packages |');
w('|---|---|---|---|');
w(`| npm | \`npm ls --all --long --json --omit=dev\` | the production dependency closure of \`app/package.json\` | ${npmPkgs.length} |`);
w(`| Rust | \`cargo metadata --format-version 1 --filter-platform <target>\` | normal (non-dev, non-build) dependencies reachable from \`vylo-editor\`, unioned over the shipped targets | ${cargoPkgs.length} |`);
w('');
w('Targets unioned on the Rust side: ' + process.env.NOTICE_TARGETS.split(/\s+/).filter(Boolean).map(t => '`' + t + '`').join(', ') + '.');
w('');
w('Not covered: npm `devDependencies` (Vite, TypeScript, esbuild, the Tauri CLI),');
w('Rust `dev-dependencies`, and Rust `build-dependencies` such as `tauri-build`.');
w('None of them is distributed. Proc-macro crates *are* listed, because they are');
w('ordinary dependency edges in the graph and telling them apart from the code');
w('that ships would mean resolving features per build rather than reading the');
w('graph — see the over-inclusiveness note above.');
w('');
w('Licence identifiers are as each package declares them. Where a package offers');
w('a choice (`MIT OR Apache-2.0`), the choice has not been exercised here — both');
w('texts are reproduced and either may be relied on.');
w('');

// Package listings, grouped by licence expression.
function section(title, pkgs) {
  w(`## ${title}`);
  w('');
  const groups = new Map();
  for (const p of pkgs) {
    const key = tidyExpr(p.expr) || 'No licence declared';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [expr, list] of ordered) {
    w(`### ${expr} — ${list.length} package${list.length === 1 ? '' : 's'}`);
    w('');
    w('| Package | Version | Copyright |');
    w('|---|---|---|');
    for (const p of list.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
      let c;
      if (p.copyright.length) c = p.copyright.map(esc).join('<br>');
      else if (p.authors && p.authors.length) c = 'Authors: ' + p.authors.map(esc).join(', ');
      else c = '_no copyright line in the package_';
      w(`| \`${p.name}\` | ${p.version} | ${c} |`);
    }
    w('');
  }
}
function esc(s) { return String(s).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

section(`npm packages (${npmPkgs.length})`, npmPkgs);
section(`Rust crates (${cargoPkgs.length})`, cargoPkgs);

// Licence texts, one per identifier, taken from the tree itself.
w('## Licence texts');
w('');
w('One text per licence identifier, reproduced from a package in this tree that');
w('ships it. Where several packages ship textually different copies of the same');
w('licence, the most common copy is the one printed and the count is noted.');
w('');
for (const id of [...texts.keys()].sort((a, b) => a.localeCompare(b))) {
  const variants = [...texts.get(id).values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from));
  const pick = variants[0];
  const total = variants.reduce((n, v) => n + v.count, 0);
  w(`### ${id}`);
  w('');
  w(`Reproduced from \`${pick.from}\`. ${total === 1 ? '1 licence file in this tree carries' : total + ' licence files in this tree carry'} ` +
    `this licence${variants.length > 1 ? `, in ${variants.length} textual variants that differ only in wording or layout` : ''}.`);
  w('');
  w('```');
  w(pick.text.replace(/\r\n/g, '\n').replace(/```/g, "'''").trimEnd());
  w('```');
  w('');
}

// Identifiers that appear in a declaration but whose text is nowhere in the tree.
const declared = new Set();
for (const p of packages) for (const id of idsIn(p.expr)) declared.add(id);
const missingText = [...declared].filter(id => !texts.has(id)).sort();
if (missingText.length) {
  w('### Identifiers with no text found in the tree');
  w('');
  w('These identifiers appear in a package\'s declaration, but no package in the');
  w('tree ships a copy of the text, so none is reproduced above. The canonical');
  w('text for each is published by SPDX at `https://spdx.org/licenses/<id>.html`.');
  w('');
  for (const id of missingText) {
    const who = packages.filter(p => idsIn(p.expr).includes(id)).map(p => `\`${p.name}\``);
    w(`- **${id}** — declared by ${who.slice(0, 8).join(', ')}${who.length > 8 ? `, and ${who.length - 8} more` : ''}`);
  }
  w('');
}

// --- MPL-2.0: the one obligation a notice does not discharge ----------------
// Every other licence here is satisfied by reproducing the notice and the text,
// which is what the two sections above do. MPL-2.0 section 3.2 also requires
// that a distributor of the Executable Form inform recipients how to obtain the
// Source Code Form, so that offer is made here, generated from the same
// package list rather than maintained by hand.
const reciprocal = packages
  .filter(p => idsIn(p.expr).includes('MPL-2.0'))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
if (reciprocal.length) {
  w('## Source for MPL-2.0 components');
  w('');
  w(`${reciprocal.length} package${reciprocal.length === 1 ? ' in' : 's in'} this binary ${reciprocal.length === 1 ? 'is' : 'are'} covered by MPL-2.0, whose section 3.2`);
  w('requires that whoever distributes the Executable Form inform each recipient');
  w('how to obtain the Source Code Form. Reproducing the licence text, which this');
  w('file also does, is not that. This section is the notice.');
  w('');
  w('Vylo Editor uses each of these unmodified, exactly as published at the version');
  w('named — the versions are pinned in `app/src-tauri/Cargo.lock` and');
  w('`app/package-lock.json` — so the Source Code Form is the published package');
  w('itself, available to anyone at no charge from:');
  w('');
  w('| Package | Version | Source Code Form |');
  w('|---|---|---|');
  for (const p of reciprocal) {
    const url = p.eco === 'cargo'
      ? `https://crates.io/crates/${p.name}/${p.version}`
      : `https://www.npmjs.com/package/${p.name}/v/${p.version}`;
    w(`| \`${p.name}\` | ${p.version} | ${url} |`);
  }
  w('');
  w('If a future release ever modifies one of them, MPL-2.0 requires the *modified*');
  w('source to be made available under MPL-2.0 as well, and this is the section');
  w('that would have to say where.');
  w('');
}

// Everything the generator could not read or could not classify, stated rather
// than quietly dropped.
w('## Gaps in this file');
w('');
if (noFile.length) {
  w(`${noFile.length} of ${packages.length} packages declare a licence but ship no licence file in`);
  w('the published archive, so no copyright line could be read from one. The');
  w('licence identifier they declare still governs; the text is reproduced above');
  w('from another package that ships it.');
  w('');
  for (const p of noFile.sort((a, b) => a.name.localeCompare(b.name))) {
    const who = p.authors && p.authors.length ? ' — authors: ' + p.authors.map(esc).join(', ') : '';
    w(`- \`${p.name}\` ${p.version} (${p.eco}, ${p.expr || 'no licence declared'})${who}`);
  }
  w('');
} else {
  w('Every package in the tree ships at least one licence file.');
  w('');
}
if (unclassified.length) {
  w('Licence files that could not be matched to a known licence text, and so were');
  w('not used as the source of any text above. Most are pointers (an SPDX');
  w('document, or a `COPYING` that names two files instead of containing a');
  w('licence) rather than licence text:');
  w('');
  for (const u of unclassified.sort()) w(`- ${u}`);
  w('');
}
if (foreignNotices.length) {
  w('Packages that carry their own third-party notices, for code vendored inside');
  w('them. Those files are not reproduced here; read them in the package:');
  w('');
  for (const p of foreignNotices.sort((a, b) => a.name.localeCompare(b.name))) {
    w(`- \`${p.name}\` ${p.version} — ${p.foreign.map(f => '`' + f + '`').join(', ')}`);
  }
  w('');
}

process.stdout.write(out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n');
NODE_EOF

NOTICE_TARGETS="$TARGETS" node "$WORK/notices.mjs" \
  "$WORK/npm.json" "$APP/package.json" "$TAURI/Cargo.toml" $METAS >"$WORK/out.md"

if [ "$CHECK" = "1" ]; then
  if [ ! -f "$OUT" ] || ! diff -q "$OUT" "$WORK/out.md" >/dev/null; then
    echo "notices: THIRD_PARTY_NOTICES.md is out of date -- run scripts/notices.sh" >&2
    diff -u "$OUT" "$WORK/out.md" 2>/dev/null | head -60 >&2 || true
    exit 1
  fi
  echo "notices: THIRD_PARTY_NOTICES.md is up to date"
  exit 0
fi

mv "$WORK/out.md" "$OUT"
echo "notices: wrote $OUT"
