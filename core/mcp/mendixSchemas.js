/** MCP tool schema for the Mendix model diff (core/mendix). */

const REPO_PARAM = { type: 'string', description: 'Optional repo path or ID (defaults to active repo)' };

export const MENDIX_SCHEMAS = [
    {
        name: 'mendix_diff',
        description: 'Mendix model changes of a branch, read from git (no checkout, no mxcli; MPR v1 and v2): commits (date, author), changed files, and per changed document (page, microflow, nanoflow, entity...) its module, folders, name, type and change. For a modified document: every added, deleted or modified element (widget, activity, parameter, sequence flow) with what it does (`detail`) and each changed property path with before and after; a pointer to another element shows as that element. For a microflow or nanoflow: before and after graphs (nodes with summary, sequence flows with case values), each node and edge with its status. Needs Node 22.13+ (`lens node`).',
        parameters: {
            type: 'object',
            properties: {
                repo: REPO_PARAM,
                from: { type: 'string', description: 'Base branch, e.g. ere or main; the diff is against its merge-base with `to`' },
                to: { type: 'string', description: 'Branch or commit with the changes, e.g. bugfix/59195-...' }
            },
            required: ['from', 'to']
        }
    }
];
