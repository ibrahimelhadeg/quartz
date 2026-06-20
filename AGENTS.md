# Quartz Fork — Agent Router

## Identity

Knowledge-graph rendering engine for the dotfiles corpus. Self-governing
vendored fork of `jackyzha0/quartz` v5. USED BY dotfiles, never edited by
it.

- Origin: `https://github.com/ibrahimelhadeg/quartz.git`
- Upstream: `https://github.com/jackyzha0/quartz.git`
- Branch: `v5` (Quartz v5.0.0)

This is an ordinary fork in its own git repo — OUTSIDE the dotfiles
two-view spec model (no README §3 / openspec governance applies here).

## Consultation contract

- Consumers (especially the dotfiles repo) **DELEGATE** to this fork's
  agents — they never reach in and hand-edit its source.
- To **understand** the fork: peek via **Context7**
  (`resolve-library-id` → `query-docs`); do not read vendored source raw.
- To **change** the fork: invoke this fork's journeys below (or brief a
  subagent with this `AGENTS.md` as its sole context).
- The fork returns a built `public/` directory plus answers.

## Customization inventory

| Customization | Where | Status |
| --- | --- | --- |
| Clickable banner-fold CSS (E1) | `quartz/styles/custom.scss` | planned (not yet built) |
| PlantUML transformer (E3) | `./plugins/plantuml` | built |
| Graph fork — local-graph readable labels + relationship-kind edges (E4) | `./plugins/graph` | built |
| Graph fork — global-graph named clusters (E5) | `./plugins/graph` | built |
| Glob `dot:true` patch to discover hidden `.claude/` | `quartz/util/glob.ts` (core helper; no plugin discovery hook exists) | built |
| PlantUML diagram responsive sizing — figure scroll container (E6) | `quartz/styles/custom.scss` | built |

**Configuration is consumer-owned.** The fork ships a GENERIC
`quartz.config.default.yaml` (upstream defaults). Each consumer provides its
own `quartz.config.yaml` (the v5 loader prefers it) — dotfiles materializes
`~/.system/setup/scripts/quartz/quartz.config.yaml` into the fork via its
`build-quartz-site.fish`, and gitignores the materialized copy here. Only the
CODE patches above (glob / plugins / scss) are fork-level; site identity,
ignore rules, and plugin wiring are NOT — keep `quartz.config.default.yaml`
generic so the fork stays reusable by other projects.

## Journeys

- **Sync-with-upstream** — rebase on `jackyzha0/quartz`; resolve
  conflicts against the local customizations above.
- **Build/serve** — corpus-sync, Node-22 pinned, `npx quartz plugin
  install` → `npx quartz build --serve`.
- **Add/modify a customization plugin** — implement under `./plugins/`,
  wire into the build, re-validate.
- **Validate the graph** — confirm the rendered graph faithfully
  represents the corpus and that links resolve.

## Agent roster

The system that maintains this fork over time:

- **Upstream Steward** — keeps `v5` current against upstream.
- **Plugin Author** — owns the local customization plugins; implements
  capability requests from consumers.
- **Site Builder** — corpus-sync + plugin install + build + serve.
- **Graph Validator** — checks the rendered graph faithfully represents
  the corpus and that links resolve.

## Quick reference

- Remotes: origin `ibrahimelhadeg/quartz`, upstream `jackyzha0/quartz`.
- Node pin: `22.16.0` (`.node-version`).
- Working build sequence:

  ```sh
  pnpm env use --global 22.16.0
  rm -rf node_modules package-lock.json
  npm install
  npx quartz plugin install
  npx quartz build
  ```

- Note: v5's plugin loader uses `npm` internally for ITS OWN deps. This
  is an accepted exception to the repo's pnpm preference — don't fight
  it.
