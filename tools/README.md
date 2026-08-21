# Dev-only checks

These scripts use Node's standard library only. There is no `package.json`, no npm install, and no
browser download. `index.html`, `app.js`, `migrate.js`, `tutorials.js` and `UHDSchematic.png` are the
deliverable; everything here is optional verification or the tutorial bundle step.

If you swap in a different `UHDSchematic.png`, tick **Align grid** in the toolbar, nudge the values
until the outlines sit on the cages, press *Copy values* and paste them back into `GEOM` in `app.js`.

## `build-tutorials.cjs` — no dependencies

```sh
node tools/build-tutorials.cjs           # write tutorials.js
node tools/build-tutorials.cjs --check   # exit 1 if it is stale
```

Bundles `docs/tutorials/*.md` into `tutorials.js`, which is what the Tutorials panel reads. The
markdown is bundled rather than fetched because the page is opened over `file://`, where fetching a
sibling file is blocked. **Re-run this after editing anything in `docs/tutorials`**, or the panel
keeps showing the previous text; `tutorials-test.cjs` fails when it is stale.

## `roundtrip-test.cjs` — no dependencies

```sh
node tools/roundtrip-test.cjs
```

Loads `app.js` against a stub DOM and checks, against the real files in `docs/samples`:

- all eleven in-scope samples validate with zero errors and stay fully editable,
- the tags this UI derives from a connection's functions equal the tags each sample ships,
- serialize → parse is lossless,
- the three breakout samples are refused, with breakout named in the message,
- a config authored through the UI code path is byte-identical to `passthrough_single_symmetric`,
- schema violations are rejected and name-pattern deviations only warn,
- port groups anchor on their first port, label every member cage, count as profile users, stay
  editable, and are rejected when malformed (empty, duplicated port, bad `ingress_distribution`,
  unknown profile, breakout channel),
- `old.new.json` in the repo root, if present, validates with every connection drawable,
- outside-entity boxes default to the port name, write nothing until customised, drop the
  `x_visualizer` key again when the last override is reset, follow a port rename, and warn (never
  error) when the key is malformed or names a port that no longer exists.

## `migrate-test.cjs` — no dependencies

```sh
node tools/migrate-test.cjs
```

Loads `migrate.js` and checks it against `uhd_migration.py`:

- the Python `--selftest` fixtures (double-encap, Q-in-Q `vlan_double`, `all_vlans`, VLAN ranges),
- hard failures (`internal` endpoints, incomplete `vlan_double`, invalid JSON),
- `.http` head/tail kept verbatim, JSON body rewritten,
- `old.json`, if present, migrates to the same document as `python3 uhd_migration.py old.json --stdout --force`.

## `tutorials-test.cjs` — no dependencies

```sh
node tools/tutorials-test.cjs
```

Renders every tutorial page through the same code the panel uses and checks:

- `tutorials.js` matches the markdown on disk, one page per file, index first,
- no markdown survives unconverted — no stray emphasis markers, backticks, table pipes, headings or
  internal placeholders reach the output,
- every heading carries the id its sidebar entry points at, and every sidebar section resolves,
- every cross-page link names a page in the bundle and an anchor that exists on it,
- a `Load into canvas` button appears exactly on the blocks the app would accept: whole configs with
  at least one port, so never a fragment, never the empty skeleton, never a breakout config,
- the inline renderer leaves lone asterisks alone, escapes HTML, ignores emphasis inside code, and
  degrades a link it cannot follow to plain text,
- JSON highlighting distinguishes keys, strings, numbers and literals, preserves the text exactly,
  and cannot inject markup.
