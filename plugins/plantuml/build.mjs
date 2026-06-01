// Prebuild the plugin to dist/. The fork's plugin loader prefers a prebuilt
// dist/ (hasPrebuiltDist) and uses it as-is, so no network npm install is
// needed at `npx quartz plugin install` time. esbuild is provided by the host
// Quartz install; this plugin has zero runtime dependencies (Node builtins only).
import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"

const here = dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [join(here, "src", "index.ts")],
  outfile: join(here, "dist", "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  packages: "external",
  sourcemap: true,
})

// Emit a minimal hand-written .d.ts (no tsc dependency required at build time).
mkdirSync(join(here, "dist"), { recursive: true })
writeFileSync(
  join(here, "dist", "index.d.ts"),
  [
    "export interface PlantUMLOptions {",
    "  command: string",
    "  cache: boolean",
    "  cacheDir?: string",
    "}",
    "export declare function plantuml(userOpts?: Partial<PlantUMLOptions>): {",
    "  name: string",
    "  markdownPlugins(): unknown[]",
    "}",
    "",
  ].join("\n"),
  "utf-8",
)

console.log("plantuml plugin built -> dist/index.js")
