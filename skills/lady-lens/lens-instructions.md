# Code search: lady-lens first

For every code-search or code-navigation task in a repository, use the `lady-lens` MCP tools first (in Claude Code: `mcp__lady-lens__*`).

1. If the repository is not registered, register it with `repo_add({ path, sync: true })`; when a result reports `synced: false`, run `repo_sync`.
2. Search and navigate with lady-lens: `grep`, `glob`, `searchView`, `definedIn`, `exports`, `imports`, `importedBy`, `functionView`, `folderView`, `graph_query`, `read_chunk`.
3. Use built-in search (`rg`, `grep`, `Glob`, shell search) only when lady-lens is unavailable, the graph is not synced, lady-lens returns nothing, or the target is outside the indexed repository.
4. When lady-lens is unavailable, say so once, so the user can restart it (`lens mcp -d`) or reconnect it.
5. Name the lady-lens tool you used when you report a result.

The lady-lens skill has the full tool list and the workflow.
