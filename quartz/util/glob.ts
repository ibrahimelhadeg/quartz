import path from "path"
import { FilePath } from "./path"
import { globby } from "globby"

export function toPosixPath(fp: string): string {
  return fp.split(path.sep).join("/")
}

export async function glob(
  pattern: string,
  cwd: string,
  ignorePatterns: string[],
): Promise<FilePath[]> {
  const fps = (
    await globby(pattern, {
      cwd,
      ignore: ignorePatterns,
      gitignore: true,
      // FORK CUSTOMIZATION (rebase-survivable): globby defaults to `dot: false`,
      // which silently drops every file living under a leading-dot path segment
      // (e.g. content/.claude/**, .codex/**, .opencode/**). The dotfiles corpus
      // homes agent docs under such dot-directories, so without this they never
      // become pages. `dot: true` widens DISCOVERY only — it does NOT disable
      // ignores: `ignorePatterns` (private, templates, .obsidian) and
      // `gitignore: true` still apply, since globby's `ignore` matcher excludes
      // a named dot-directory (.obsidian) regardless of the `dot` flag.
      // Re-applied here (core helper) because Quartz's plugin model has no
      // content-discovery hook — discovery runs in build.ts before any plugin.
      dot: true,
    })
  ).map(toPosixPath)
  return fps as FilePath[]
}
