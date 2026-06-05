# Quartz Fork — Backlog

Deferred work for this self-governing fork. See [AGENTS.md](AGENTS.md) for the
journeys, customization inventory, and agent roster that own these items.

## Tasks

1. **Make the `dot:true` discovery patch survive upstream rebases.** The
   dot-directory content-discovery fix (commit `902ac74`) lives in **core**
   `quartz/util/glob.ts` because Quartz exposes no content-discovery plugin
   hook (discovery runs in `build.ts` before any plugin loads). A
   `Sync-with-upstream` rebase onto `jackyzha0/quartz` can silently drop it.
   - **Why it matters:** the consumer (dotfiles `knowledge-graph-site`) syncs
     `.claude/` + the AI-config mirrors into `content/` and enforces an
     emit-completeness gate; losing this patch re-drops ~78 dot-directory pages
     and **hard-fails the consumer's build**.
   - **Owner:** Upstream Steward (re-apply on rebase) + Plugin Author (find a
     durable mechanism).
   - **Options:** (a) add a re-apply checkpoint to the Sync-with-upstream
     journey's conflict-resolution checklist; (b) upstream a `dot` discovery
     option to `jackyzha0/quartz` so it stops being a local patch; (c) move it
     behind a thin local seam if one becomes available.
   - **Done when:** the patch survives an upstream rebase without manual
     intervention, OR the Sync journey guarantees its re-application.
