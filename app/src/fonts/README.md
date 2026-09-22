# Arabic and Kurdish

`arabic.woff2` is Noto Sans Arabic (SIL OFL 1.1), subset to the Arabic blocks
and instanced to weights 400–700. 79 KB.

It is bundled rather than fetched because this is a desktop app: it has to
render a Kurdish filename on a laptop with no network.

**Why this face and not a prettier one.** Sorani and Badini need five letters
plain Arabic does not have — ڕ ڵ ۆ ێ ە — and a lot of well-known Arabic
typefaces simply lack them. Cairo does. Rubik does. A font missing them does
not fail loudly; it silently falls back per-character, so a Kurdish sentence
renders in two different faces and nobody can say why it looks wrong.

To swap it, check the replacement first:

    python3 - <<'PY'
    from fontTools.ttLib import TTFont
    f = TTFont("candidate.ttf"); cmap = set()
    for t in f["cmap"].tables: cmap |= set(t.cmap.keys())
    missing = [hex(c) for c in (0x0695, 0x06B5, 0x06C6, 0x06CE, 0x06D5) if c not in cmap]
    print("missing:", missing or "none")
    PY

`test/fonts.test.mjs` asserts the file is here, is a woff2, and that the
stylesheet scopes it to Arabic script with `unicode-range` — without that
scoping it would also claim Latin, and the whole interface would change
typeface.
