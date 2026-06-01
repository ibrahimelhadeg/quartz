// plugins/plantuml/src/transformer.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var DEFAULTS = {
  command: "plantuml",
  cache: true
};
function cleanSvg(svg) {
  const start = svg.indexOf("<svg");
  if (start <= 0) return svg.trim();
  return svg.slice(start).trim();
}
function renderSvg(source, command) {
  try {
    const out = execFileSync(command, ["-tsvg", "-pipe"], {
      input: source,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"]
    });
    if (!out || out.indexOf("<svg") === -1) return null;
    if (out.includes("Syntax Error") || out.includes("An error has occured")) return null;
    return cleanSvg(out);
  } catch {
    return null;
  }
}
function plantuml(userOpts) {
  const opts = { ...DEFAULTS, ...userOpts };
  const cacheDir = opts.cacheDir ?? join(process.cwd(), ".quartz-cache", "plantuml");
  function fromCache(hash) {
    if (!opts.cache) return null;
    const file = join(cacheDir, `${hash}.svg`);
    return existsSync(file) ? readFileSync(file, "utf-8") : null;
  }
  function toCache(hash, svg) {
    if (!opts.cache) return;
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${hash}.svg`), svg, "utf-8");
    } catch {
    }
  }
  return {
    name: "PlantUML",
    markdownPlugins() {
      return [
        () => (tree) => {
          const visit = (node) => {
            const children = node.children;
            if (!children) return;
            for (let i = 0; i < children.length; i++) {
              const child = children[i];
              if (child.type === "code" && child.lang === "plantuml") {
                const code = child;
                const hash = createHash("sha256").update(code.value).digest("hex").slice(0, 16);
                let svg = fromCache(hash);
                if (svg === null) {
                  svg = renderSvg(code.value, opts.command);
                  if (svg !== null) toCache(hash, svg);
                }
                if (svg !== null) {
                  const html = {
                    type: "html",
                    value: `<figure class="plantuml-diagram">${svg}</figure>`
                  };
                  children[i] = html;
                }
                continue;
              }
              visit(child);
            }
          };
          visit(tree);
        }
      ];
    }
  };
}
plantuml.quartzCategory = "transformer";
export {
  plantuml
};
//# sourceMappingURL=index.js.map
