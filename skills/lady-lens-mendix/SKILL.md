---
name: lady-lens-mendix
description: Use for Mendix projects (a folder with a .mpr file): find pages, widgets, microflows, nanoflows and their settings with Lady-lens, and change or check them with mxcli.
---

# Mendix with Lady-lens

A Mendix model lives in the binary `.mpr`; plain text search does not see it. `lens sync` asks `mxcli` for the MDL text of
every document and writes it to `.mxcli/mdl/<Module>/<Name>.<type>.mdl` (type: page, snippet, microflow, nanoflow,
entity, enumeration, ...). Lady-lens tools search those files like code.

## Find

1. Register and sync the project: `repo_add({ path, sync: true })`, or `repo_sync` after a branch switch or a change in Studio Pro.
2. Search settings and widgets with `grep` on `.mxcli/mdl`, e.g. `grep({ pattern: "FilterType: 'startsWith'", path: ".mxcli/mdl" })`.
   A hit names the document: `.mxcli/mdl/Sales/Order_New.page.mdl` is page `Sales.Order_New`.
3. Find documents by name with `glob({ pattern: ".mxcli/mdl/Sales/*.page.mdl" })`; read one with `read_chunk({ path })`.
4. Module, page and widget structure, and which widget calls which microflow, are in the graph: `graph_query`.
5. Check every module the question covers, not only the one named: list all hits before changing anything.

If `.mxcli/mdl` is missing or empty, the source index was never built. Build it once (slow on a big project, later runs only
redo what changed), then `repo_sync`:

```
mxcli -p <App.mpr> -c "refresh catalog full source"
```

## Compare branches

- "What does this branch change in the model?": `mendix_diff({ from: "<base branch>", to: "<branch>" })`. It reads both
  versions of the model from git (no checkout, no mxcli, seconds): the commits, every changed page, microflow, nanoflow or
  entity with its module, and per document the added, deleted and modified elements with each property before and after.
- `.mxunit` and `.mpr` files are binary: `branch_diff`, `grep` and the `.mxcli/mdl` copy cannot show model changes between
  commits; `mendix_diff` can. For a microflow or nanoflow, `flow.before` and `flow.after` hold the graph of both versions.
- Report a change with the document's qualified name and the element (`name`, or `detail` for an activity such as
  `NanoflowCallAction: Module.Flow`), the property path and its before and after value.

## Change

- `.mxcli/mdl` is a read-only copy. Editing it changes nothing in the model; change the model with `mxcli`
  (`describe page <Module.Page>` shows the current MDL, then `alter page` or `create or modify page`).
- Close the project in Studio Pro first, or work on a branch that Studio Pro does not have open.
- Validate a script with `mxcli check <script.mdl>` before running it, and run `repo_sync` afterwards so the copy is current.
- Report which pages and widgets you changed, with their qualified names.

## Requirements

- `mxcli` on the PATH, or its full path in `LENS_MXCLI_PATH`.
- Node 22.13 or newer for the MDL export and `mendix_diff` (older Node warns and skips the export). Keep PATH and nvm as they are: `lens node "C:\Program Files\nodejs\node.exe"` makes lens, its daemon and the agent registrations run on that newer Node.
- `.mxcli/` stays out of git (it is in the `.gitignore` of a project set up with `mxcli init`).
