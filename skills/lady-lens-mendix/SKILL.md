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

## Change

- `.mxcli/mdl` is a read-only copy. Editing it changes nothing in the model; change the model with `mxcli`
  (`describe page <Module.Page>` shows the current MDL, then `alter page` or `create or modify page`).
- Close the project in Studio Pro first, or work on a branch that Studio Pro does not have open.
- Validate a script with `mxcli check <script.mdl>` before running it, and run `repo_sync` afterwards so the copy is current.
- Report which pages and widgets you changed, with their qualified names.

## Requirements

- `mxcli` on the PATH, or its full path in `LENS_MXCLI_PATH`.
- Node 22.5 or newer for the MDL export (it reads mxcli's `.mxcli/catalog.db`).
- `.mxcli/` stays out of git (it is in the `.gitignore` of a project set up with `mxcli init`).
