//! A local index of the open folder: symbols, and BM25 ranking for search.
//!
//! ## Why not embeddings
//!
//! Anthropic has no embeddings endpoint, so vector search would mean adding a
//! second vendor, a second key, and project source leaving the machine — which
//! contradicts the one thing this product is sold on. BM25 over identifier
//! tokens plus a symbol table gets most of the way for none of that, and works
//! offline.
//!
//! ## Why it is not written to disk
//!
//! The plan said to persist it. Measured on a real project the whole build is a
//! few milliseconds, and `search` already walks and reads every file on every
//! call, so persistence would buy nothing while adding a serialisation format,
//! a version to migrate, staleness to detect and corruption to survive. It is
//! held in memory and rebuilt when the file stamps change.
//!
//! The stamp is every indexed path and its mtime. Collecting it needs a walk
//! but no reads, which is the cheap half of the work, so a query on an unchanged
//! tree costs a directory walk and nothing else.

use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

const K1: f64 = 1.2;
const B: f64 = 0.75;
/// Files above this are skipped: a minified bundle is not worth indexing and
/// would dominate the term statistics if it were.
const MAX_FILE: u64 = 512 * 1024;

#[derive(Clone, Serialize)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: usize,
}

pub struct Index {
    stamp: Vec<(String, u64)>,
    paths: Vec<String>,
    lens: Vec<f64>,
    /// term -> [(document, times it appears)]
    postings: HashMap<String, Vec<(u32, u32)>>,
    pub symbols: Vec<Symbol>,
    avg_len: f64,
}

/// Identifier tokens, plus the pieces of compound names.
///
/// `resolveMention` yields `resolvemention`, `resolve` and `mention`, so a
/// search for either half finds it. Without that split, an index over source
/// code only ever matches whole identifiers, which is the case grep already
/// handles.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for word in text.split(|c: char| !(c.is_alphanumeric() || c == '_')) {
        if word.len() < 2 {
            continue;
        }
        let lower = word.to_lowercase();
        if lower.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        // Sub-tokens first, so a compound name is findable by either half.
        let mut piece = String::new();
        let mut pieces: Vec<String> = Vec::new();
        let mut prev_lower = false;
        for ch in word.chars() {
            let boundary = ch == '_' || (ch.is_uppercase() && prev_lower);
            if boundary && !piece.is_empty() {
                pieces.push(std::mem::take(&mut piece));
            }
            if ch != '_' {
                piece.push(ch.to_ascii_lowercase());
            }
            prev_lower = ch.is_lowercase() || ch.is_ascii_digit();
        }
        if !piece.is_empty() {
            pieces.push(piece);
        }
        if pieces.len() > 1 {
            out.extend(pieces.into_iter().filter(|p| p.len() >= 2));
        }
        out.push(lower);
    }
    out
}

/// Declaration keywords by language, longest pattern first so `export function`
/// is not swallowed by `function`.
fn rules(ext: &str) -> &'static [(&'static [&'static str], &'static str)] {
    match ext {
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" => &[
            (&["export", "async", "function"], "function"),
            (&["export", "default", "function"], "function"),
            (&["export", "function"], "function"),
            (&["export", "interface"], "interface"),
            (&["export", "class"], "class"),
            (&["export", "const"], "const"),
            (&["export", "type"], "type"),
            (&["export", "enum"], "enum"),
            (&["async", "function"], "function"),
            (&["function"], "function"),
            (&["interface"], "interface"),
            (&["class"], "class"),
            (&["type"], "type"),
            (&["enum"], "enum"),
        ],
        "rs" => &[
            (&["pub", "async", "fn"], "fn"),
            (&["pub", "fn"], "fn"),
            (&["pub", "struct"], "struct"),
            (&["pub", "trait"], "trait"),
            (&["pub", "enum"], "enum"),
            (&["pub", "type"], "type"),
            (&["pub", "mod"], "mod"),
            (&["async", "fn"], "fn"),
            (&["fn"], "fn"),
            (&["struct"], "struct"),
            (&["trait"], "trait"),
            (&["enum"], "enum"),
            (&["impl"], "impl"),
            (&["type"], "type"),
            (&["mod"], "mod"),
        ],
        "py" => &[(&["async", "def"], "def"), (&["def"], "def"), (&["class"], "class")],
        "go" => &[(&["func"], "func"), (&["type"], "type")],
        "rb" => &[(&["def"], "def"), (&["class"], "class"), (&["module"], "module")],
        "php" => &[(&["function"], "function"), (&["class"], "class"), (&["interface"], "interface")],
        "java" | "cs" | "kt" | "swift" => &[
            (&["public", "interface"], "interface"),
            (&["public", "class"], "class"),
            (&["interface"], "interface"),
            (&["class"], "class"),
            (&["struct"], "struct"),
            (&["enum"], "enum"),
            (&["func"], "func"),
        ],
        _ => &[],
    }
}

fn ident(word: &str) -> String {
    word.trim_matches(|c: char| !(c.is_alphanumeric() || c == '_')).to_string()
}

/// Declarations in one file. Deliberately not a parser: a keyword at the start
/// of a line followed by a name catches what people actually search for, and
/// costs nothing next to a syntax tree per language.
pub fn symbols_in(path: &str, text: &str) -> Vec<Symbol> {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let mut out = Vec::new();

    if matches!(ext.as_str(), "md" | "markdown" | "mdx") {
        for (n, line) in text.lines().enumerate() {
            let t = line.trim_start();
            if t.starts_with('#') {
                let name = t.trim_start_matches('#').trim();
                if !name.is_empty() {
                    out.push(Symbol {
                        name: name.to_string(),
                        kind: "heading".into(),
                        path: path.to_string(),
                        line: n + 1,
                    });
                }
            }
        }
        return out;
    }

    let table = rules(&ext);
    if table.is_empty() {
        return out;
    }
    for (n, line) in text.lines().enumerate() {
        let words: Vec<&str> = line.split_whitespace().take(5).collect();
        if words.is_empty() {
            continue;
        }
        for (pattern, kind) in table {
            if words.len() <= pattern.len() {
                continue;
            }
            if pattern.iter().enumerate().all(|(i, w)| ident(words[i]) == **w) {
                let name = ident(words[pattern.len()]);
                if !name.is_empty() && name.chars().next().is_some_and(|c| c.is_alphabetic() || c == '_') {
                    out.push(Symbol {
                        name,
                        kind: (*kind).to_string(),
                        path: path.to_string(),
                        line: n + 1,
                    });
                }
                break;
            }
        }
    }
    out
}

/// Every indexable file and its mtime. The cheap half of the work, and enough
/// to tell whether the expensive half needs doing again.
///
/// The walk is `crate::walk`, which is also what `list_tree` and `search` use.
/// It used to be a second one with its own depth (12, against their 8) and its
/// own list of names to skip (which had `coverage` and `.test-build` that
/// theirs did not, and lacked `Pods`, `.gradle` and `.idea` that theirs had).
/// Two walkers meant two answers to "what is in this project", and the agent
/// could see both: `find_symbol` named files `search` denied existed.
///
/// The skip count is not collected here. This runs on *every* `search`,
/// `find_symbol` and `list_symbols` to decide whether the index is stale, and
/// counting costs an extra `read_dir` per directory for a number no caller of
/// this function reports.
fn stamp_of(root: &Path) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = crate::walk::walk(root, crate::walk::MAX_WALK, false)
        .found
        .into_iter()
        .filter(|f| f.is_file && f.size <= MAX_FILE)
        .map(|f| (f.rel, f.mtime))
        .collect();
    out.sort();
    out
}

fn build(root: &Path, stamp: Vec<(String, u64)>) -> Index {
    let mut paths = Vec::new();
    let mut lens = Vec::new();
    let mut postings: HashMap<String, Vec<(u32, u32)>> = HashMap::new();
    let mut symbols = Vec::new();

    for (rel, _) in &stamp {
        let Ok(text) = std::fs::read_to_string(root.join(rel)) else { continue };
        let doc = paths.len() as u32;

        let mut counts: HashMap<String, u32> = HashMap::new();
        let toks = tokenize(&text);
        for t in &toks {
            *counts.entry(t.clone()).or_insert(0) += 1;
        }
        for (term, tf) in counts {
            postings.entry(term).or_default().push((doc, tf));
        }

        symbols.extend(symbols_in(rel, &text));
        lens.push(toks.len() as f64);
        paths.push(rel.clone());
    }

    let avg_len = if lens.is_empty() { 1.0 } else { lens.iter().sum::<f64>() / lens.len() as f64 };
    Index { stamp, paths, lens, postings, symbols, avg_len }
}

impl Index {
    /// BM25, per file, for the terms in a query. Files with no term score 0 and
    /// keep whatever order they came in, which is what makes ranking safe to
    /// layer over a literal search.
    pub fn rank(&self, query: &str) -> HashMap<String, f64> {
        let n = self.paths.len() as f64;
        let mut scores: HashMap<u32, f64> = HashMap::new();
        for term in tokenize(query) {
            let Some(list) = self.postings.get(&term) else { continue };
            let df = list.len() as f64;
            let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
            for (doc, tf) in list {
                let tf = *tf as f64;
                let len = self.lens[*doc as usize];
                let norm = tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * len / self.avg_len));
                *scores.entry(*doc).or_insert(0.0) += idf * norm;
            }
        }
        scores
            .into_iter()
            .map(|(doc, s)| (self.paths[doc as usize].clone(), s))
            .collect()
    }
}

#[derive(Default)]
pub struct Indexes(pub std::sync::Mutex<HashMap<String, Index>>);

/// The index for a root, rebuilt only when the file stamps have moved.
pub fn with_index<T>(state: &Indexes, root: &str, f: impl FnOnce(&Index) -> T) -> Result<T, String> {
    let dir = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("workspace root is unreadable: {e}"))?;
    let stamp = stamp_of(&dir);

    let mut map = state.0.lock().map_err(|_| "index state is unusable".to_string())?;
    let fresh = map.get(root).map(|i| i.stamp == stamp).unwrap_or(false);
    if !fresh {
        map.insert(root.to_string(), build(&dir, stamp));
    }
    Ok(f(map.get(root).expect("just inserted")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compound_names_are_findable_by_either_half() {
        let t = tokenize("resolveMention");
        assert!(t.contains(&"resolve".to_string()), "{t:?}");
        assert!(t.contains(&"mention".to_string()), "{t:?}");
        assert!(t.contains(&"resolvemention".to_string()), "the whole name too: {t:?}");
    }

    #[test]
    fn snake_case_splits_as_well() {
        let t = tokenize("apply_write");
        assert!(t.contains(&"apply".to_string()) && t.contains(&"write".to_string()), "{t:?}");
    }

    #[test]
    fn noise_is_dropped() {
        let t = tokenize("a b 42 1234 ok");
        assert!(!t.contains(&"a".to_string()), "single letters: {t:?}");
        assert!(!t.contains(&"42".to_string()), "bare numbers: {t:?}");
        assert!(t.contains(&"ok".to_string()), "{t:?}");
    }

    #[test]
    fn typescript_declarations_are_found() {
        let src = "export function alpha() {}\nfunction beta() {}\nexport const gamma = 1;\n\
                   export interface Delta {}\nclass Epsilon {}\n  const hidden = 2;\n";
        let s = symbols_in("a.ts", src);
        let names: Vec<&str> = s.iter().map(|x| x.name.as_str()).collect();
        assert!(names.contains(&"alpha") && names.contains(&"beta"), "{names:?}");
        assert!(names.contains(&"gamma") && names.contains(&"Delta") && names.contains(&"Epsilon"), "{names:?}");
        assert!(!names.contains(&"hidden"), "an unexported local is noise: {names:?}");
        let alpha = s.iter().find(|x| x.name == "alpha").unwrap();
        assert_eq!(alpha.kind, "function");
        assert_eq!(alpha.line, 1, "line numbers are 1-based");
    }

    #[test]
    fn rust_declarations_are_found_with_their_kind() {
        let s = symbols_in("a.rs", "pub fn open() {}\nstruct Session {}\npub trait Store {}\n");
        let by = |n: &str| s.iter().find(|x| x.name == n).map(|x| x.kind.clone());
        assert_eq!(by("open"), Some("fn".into()));
        assert_eq!(by("Session"), Some("struct".into()));
        assert_eq!(by("Store"), Some("trait".into()));
    }

    #[test]
    fn python_and_markdown_are_handled() {
        let p = symbols_in("a.py", "def run():\n    pass\nclass Thing:\n    pass\n");
        assert_eq!(p.len(), 2, "{p:?}", p = p.iter().map(|x| &x.name).collect::<Vec<_>>());
        let m = symbols_in("a.md", "# Title\nprose\n## Section\n");
        assert_eq!(m.len(), 2);
        assert_eq!(m[1].name, "Section");
        assert_eq!(m[1].kind, "heading");
    }

    #[test]
    fn an_unknown_language_yields_nothing_rather_than_guesses() {
        assert!(symbols_in("a.xyz", "function nope() {}").is_empty());
    }

    #[test]
    fn ranking_prefers_the_file_that_is_actually_about_the_term() {
        let tmp = std::env::temp_dir().join(format!("vylo_idx_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        // One file is about checkpoints; the other mentions them once in passing.
        std::fs::write(tmp.join("checkpoint.rs"),
            "pub fn checkpoint_save() {}\n// checkpoint checkpoint checkpoint restore\n").unwrap();
        std::fs::write(tmp.join("other.rs"),
            &format!("// a checkpoint is mentioned once here\n{}\n", "fn unrelated() {}\n".repeat(40))).unwrap();

        let state = Indexes::default();
        let root = tmp.to_string_lossy().to_string();
        let scores = with_index(&state, &root, |i| i.rank("checkpoint")).unwrap();
        let a = scores.get("checkpoint.rs").copied().unwrap_or(0.0);
        let b = scores.get("other.rs").copied().unwrap_or(0.0);
        assert!(a > b, "checkpoint.rs {a} should outrank other.rs {b}");

        // A term nobody uses scores nothing at all, rather than ranking noise.
        let none = with_index(&state, &root, |i| i.rank("zzzqqq")).unwrap();
        assert!(none.is_empty(), "{none:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// The other half of the disagreement. `search` now reaches depth 11, and
    /// the index has to reach exactly as far or `find_symbol` goes back to
    /// naming files `search` denies exist — only with the two swapped.
    #[test]
    fn the_index_reaches_as_deep_as_the_search_does() {
        // A prefix, not a pid: these tests share a process, and two of them on
        // one path delete each other's files.
        let tmp = std::env::temp_dir().join("vylo_idx_deep");
        let _ = std::fs::remove_dir_all(&tmp);
        let deep = tmp.join("a/b/c/d/e/f/g/h/i/j");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("buried.rs"), "pub fn buried_symbol() {}\n").unwrap();

        let state = Indexes::default();
        let root = tmp.to_string_lossy().to_string();
        let names = with_index(&state, &root, |i| {
            i.symbols.iter().map(|s| s.name.clone()).collect::<Vec<_>>()
        })
        .unwrap();
        assert!(names.contains(&"buried_symbol".to_string()), "{names:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// A generated directory is generated for the index too. Indexing it would
    /// put a minified bundle's identifiers into the term statistics and offer
    /// its declarations as somewhere to go.
    #[test]
    fn a_directory_named_in_gitignore_is_not_indexed() {
        let tmp = std::env::temp_dir().join("vylo_idx_ignored");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("generated")).unwrap();
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        std::fs::write(tmp.join(".gitignore"), "generated/\n").unwrap();
        std::fs::write(tmp.join("generated/bundle.rs"), "pub fn generated_thing() {}\n").unwrap();
        std::fs::write(tmp.join("src/real.rs"), "pub fn real_thing() {}\n").unwrap();

        let state = Indexes::default();
        let root = tmp.to_string_lossy().to_string();
        let names = with_index(&state, &root, |i| {
            i.symbols.iter().map(|s| s.name.clone()).collect::<Vec<_>>()
        })
        .unwrap();
        assert!(names.contains(&"real_thing".to_string()), "{names:?}");
        assert!(!names.contains(&"generated_thing".to_string()), "{names:?}");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn the_index_is_rebuilt_only_when_the_files_move() {
        let tmp = std::env::temp_dir().join(format!("vylo_idx2_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("a.rs"), "pub fn one() {}\n").unwrap();

        let state = Indexes::default();
        let root = tmp.to_string_lossy().to_string();
        let first = with_index(&state, &root, |i| i.symbols.len()).unwrap();
        assert_eq!(first, 1);

        // Same tree, same stamp: the cached index answers.
        assert_eq!(with_index(&state, &root, |i| i.symbols.len()).unwrap(), 1);

        // A new file changes the stamp, so the next query sees it.
        std::fs::write(tmp.join("b.rs"), "pub fn two() {}\npub fn three() {}\n").unwrap();
        assert_eq!(with_index(&state, &root, |i| i.symbols.len()).unwrap(), 3);

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
