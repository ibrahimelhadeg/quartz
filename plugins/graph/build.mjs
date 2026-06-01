// Prebuild the graph plugin to dist/. The fork's plugin loader prefers a
// prebuilt dist/ (hasPrebuiltDist) and uses it as-is, so no network npm install
// or tsup is needed at `npx quartz plugin install` time. This replicates the
// upstream tsup.config.ts behaviour (scss -> text, *.inline.ts -> bundled text,
// preact JSX automatic, singletons external) using esbuild directly. esbuild +
// sass are provided by the host Quartz install.
import { build } from "esbuild"
import { compile } from "sass"
import { fileURLToPath } from "node:url"
import { dirname, join, relative } from "node:path"
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"

const here = dirname(fileURLToPath(import.meta.url))

// Mirror tsup.config.ts SINGLETON_EXTERNALS: never bundle the shared runtime
// singletons; the host Quartz / sibling plugins provide them.
const external = [
  "preact",
  "preact/hooks",
  "preact/jsx-runtime",
  "preact/compat",
  "@jackyzha0/quartz",
  "@jackyzha0/quartz/*",
  "@quartz-community/*",
  "vfile",
  "vfile/*",
  "unified",
]

// Loader for *.scss imports -> compiled CSS as a text (string) export.
const scssTextPlugin = {
  name: "scss-text-loader",
  setup(b) {
    b.onLoad({ filter: /\.scss$/ }, (args) => {
      const result = compile(args.path)
      return { contents: result.css, loader: "text" }
    })
  },
}

// Loader for *.inline.ts -> a self-contained, browser-targeted, minified bundle
// returned as a text (string) export (the afterDOMLoaded script body).
const inlineScriptPlugin = {
  name: "inline-script-loader",
  setup(b) {
    b.onLoad({ filter: /\.inline\.ts$/ }, async (args) => {
      let text = readFileSync(args.path, "utf8")
      text = text.replace(/^export default /gm, "")
      text = text.replace(/^export /gm, "")
      const result = await build({
        stdin: {
          contents: text,
          loader: "ts",
          resolveDir: dirname(args.path),
          sourcefile: relative(here, args.path),
        },
        write: false,
        bundle: true,
        minify: true,
        platform: "browser",
        format: "esm",
        target: "es2020",
        sourcemap: false,
        external: ["http://*", "https://*"],
      })
      const js = result.outputFiles?.[0]?.text
      if (!js) throw new Error(`inline-script-loader: no JS output for ${args.path}`)
      return { contents: js, loader: "text" }
    })
  },
}

await build({
  entryPoints: {
    index: join(here, "src", "index.ts"),
    types: join(here, "src", "types.ts"),
    "components/index": join(here, "src", "components", "index.ts"),
  },
  outdir: join(here, "dist"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  splitting: false,
  sourcemap: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  external,
  plugins: [scssTextPlugin, inlineScriptPlugin],
})

// Minimal hand-written .d.ts files (no tsc dependency required at build time).
// These keep package.json "exports".types resolvable for editor tooling.
mkdirSync(join(here, "dist", "components"), { recursive: true })

const componentDts = [
  "import type { QuartzComponent, QuartzComponentConstructor } from '@quartz-community/types';",
  "export interface D3Config {",
  "  drag: boolean; zoom: boolean; depth: number; scale: number;",
  "  repelForce: number; centerForce: number; linkDistance: number;",
  "  fontSize: number; opacityScale: number; removeTags: string[]; showTags: boolean;",
  "  focusOnHover?: boolean; enableRadial?: boolean; showLabels?: boolean; legend?: boolean;",
  "}",
  "export interface GraphOptions {",
  "  localGraph?: Partial<D3Config>;",
  "  globalGraph?: Partial<D3Config>;",
  "}",
  "declare const _default: QuartzComponentConstructor<Partial<GraphOptions>>;",
  "export default _default;",
  "export declare const Graph: QuartzComponent;",
  "",
].join("\n")

writeFileSync(join(here, "dist", "components", "index.d.ts"), componentDts, "utf-8")
writeFileSync(
  join(here, "dist", "index.d.ts"),
  [
    "export { default as Graph } from './components/index';",
    "export type { GraphOptions, D3Config } from './components/index';",
    "",
  ].join("\n"),
  "utf-8",
)
writeFileSync(join(here, "dist", "types.d.ts"), "export {};\n", "utf-8")

console.log("graph plugin built -> dist/{index,types,components/index}.js")
