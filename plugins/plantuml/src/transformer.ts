import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Code, Html, Root, RootContent } from "mdast"

export interface PlantUMLOptions {
  /** Path to the plantuml CLI. Defaults to "plantuml" (resolved on PATH). */
  command: string
  /** Cache rendered SVGs under <cacheDir>/<hash>.svg to skip re-rendering. */
  cache: boolean
  /** Cache directory root. Defaults to <cwd>/.quartz-cache/plantuml. */
  cacheDir?: string
}

const DEFAULTS: PlantUMLOptions = {
  command: "plantuml",
  cache: true,
}

/**
 * Strip the XML prolog (`<?xml ...?>`), DOCTYPE, and any leading processing
 * instructions so the SVG can be inlined directly into HTML. PlantUML may emit
 * a `<?plantuml ...?>` PI immediately after the opening `<svg>` tag; that is
 * harmless inside HTML, so we only trim what precedes the root `<svg>` element.
 */
function cleanSvg(svg: string): string {
  const start = svg.indexOf("<svg")
  if (start <= 0) return svg.trim()
  return svg.slice(start).trim()
}

/**
 * Render PlantUML source to an SVG string via the local CLI.
 * Returns null on any failure (non-zero exit, empty output, missing binary,
 * or an error-image render) so the caller can fall back to the original code
 * listing — a broken diagram must never break the page or the build.
 *
 * `plantuml -tsvg -pipe` reads source on stdin, writes SVG to stdout, and
 * exits 0 for a valid diagram / non-zero (200) for a syntax error.
 * `execFileSync` throws on non-zero exit, so that path is caught below. As a
 * defensive second check, output carrying PlantUML's error marker is also
 * rejected in case a future CLI version returns 0 on a soft error.
 */
function renderSvg(source: string, command: string): string | null {
  try {
    const out = execFileSync(command, ["-tsvg", "-pipe"], {
      input: source,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    })
    if (!out || out.indexOf("<svg") === -1) return null
    if (out.includes("Syntax Error") || out.includes("An error has occured")) return null
    return cleanSvg(out)
  } catch {
    return null
  }
}

export function plantuml(userOpts?: Partial<PlantUMLOptions>) {
  const opts: PlantUMLOptions = { ...DEFAULTS, ...userOpts }
  const cacheDir = opts.cacheDir ?? join(process.cwd(), ".quartz-cache", "plantuml")

  function fromCache(hash: string): string | null {
    if (!opts.cache) return null
    const file = join(cacheDir, `${hash}.svg`)
    return existsSync(file) ? readFileSync(file, "utf-8") : null
  }

  function toCache(hash: string, svg: string): void {
    if (!opts.cache) return
    try {
      mkdirSync(cacheDir, { recursive: true })
      writeFileSync(join(cacheDir, `${hash}.svg`), svg, "utf-8")
    } catch {
      // Caching is best-effort; never fail a build over a cache write.
    }
  }

  return {
    name: "PlantUML",
    markdownPlugins() {
      return [
        () => (tree: Root) => {
          // Manual recursive walk over mdast `code` nodes. Replacing a node in
          // place (code -> html) is simplest done by mutating the parent's
          // children array, so we recurse with parent context.
          const visit = (node: { children?: RootContent[] }) => {
            const children = node.children
            if (!children) return
            for (let i = 0; i < children.length; i++) {
              const child = children[i]
              if (child.type === "code" && (child as Code).lang === "plantuml") {
                const code = child as Code
                const hash = createHash("sha256").update(code.value).digest("hex").slice(0, 16)
                let svg = fromCache(hash)
                if (svg === null) {
                  svg = renderSvg(code.value, opts.command)
                  if (svg !== null) toCache(hash, svg)
                }
                if (svg !== null) {
                  const html: Html = {
                    type: "html",
                    value: `<figure class="plantuml-diagram">${svg}</figure>`,
                  }
                  children[i] = html
                }
                // svg === null: leave the code node untouched (fallback).
                continue
              }
              visit(child as { children?: RootContent[] })
            }
          }
          visit(tree)
        },
      ]
    },
  }
}

// Mark the factory's processing category for the loader's category detector.
;(plantuml as unknown as { quartzCategory: string }).quartzCategory = "transformer"
