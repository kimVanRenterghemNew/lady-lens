/** MCP tool schema for the Mendix model diff (core/mendix). */

const REPO_PARAM = { type: 'string', description: 'Optional repo path or ID (defaults to active repo)' };

export const MENDIX_SCHEMAS = [
    {
        name: 'mendix_diff',
        description: 'Mendix model changes of a branch, read from git or disk worktree (no checkout, no mxcli; MPR v1 and v2): commits (date, author), changed files, widgets summary (packages added/removed/modified and disk count), and per changed document (page, microflow, nanoflow, entity...) its module, folders, name, type and change. For an added, deleted or modified document: elements (widget, activity, parameter, sequence flow) with what it does (`detail`) and each changed property path; a pointer to another element shows as that element. For a microflow or nanoflow: before and after graphs (nodes with summary, sequence flows with case values), each node and edge with its status. Needs Node 22.13+ (`lens node`).',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                from: { type: 'string', description: 'Base branch or folder path, e.g. main or C:/Mendix/ere; the diff is against its merge-base with `to`' },
                to: { type: 'string', description: 'Branch, commit, folder path, or "working-tree" with the changes' },
                detail: { type: 'string', enum: ['changes', 'summary', 'full'], description: 'Output level: "changes" (compact, default for agents), "summary" (counts only), "full" (all properties)' },
                ignore: { type: 'array', items: { type: 'string' }, description: 'Noise filters to ignore and count, e.g. ["translations", "layout"]' },
                documents: { type: 'array', items: { type: 'string' }, description: 'Filter by document name or qualified name' },
                modules: { type: 'array', items: { type: 'string' }, description: 'Filter by module name' }
            },
            required: ['from', 'to']
        }
    }
];
