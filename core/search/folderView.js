// TODO(coverage): Current line coverage is 0% (< 85% target). Raise to >= 85%.
import { contextBudget } from '../configuration/index.js';
import { folderView, renderFolderView } from '../graph/index.js';
import { refreshProjectGraph, loadGraphModel, readRepoFile } from './graphModelLoader.js';
import { packageFolderView } from './packageFolderView.js';

export async function folderViewTool(args, { refresh = refreshProjectGraph, maxChars } = {}) {
    const { folder } = args ?? {};
    if (typeof folder !== 'string' || !folder.trim()) {
        return { error: 'folder is required (repo-relative, e.g. "core/graph")' };
    }
    const freshness = await refresh();
    let loaded;
    try {
        loaded = await loadGraphModel({ sessionId: 'default', text: '', includeProject: true, includeDocs: false });
    } catch (error) {
        return { error: `could not load graph: ${error.message}` };
    }
    const view = folderView(loaded.graph, folder, { readFile: readRepoFile });
    if (!view.found) return { relation: 'folderView', ...view, text: '', freshness };
    const pkg = view.entry?.package ? await packageFolderView(view.entry.package) : null;
    const budget = maxChars ?? Math.min(6000, contextBudget().toolResultChars);
    const text = [
        renderFolderView(view, { maxChars: pkg?.view.found ? Math.floor(budget / 3) : budget }),
        pkg?.view.found ? `\nInside the package "${pkg.name}" (its own folder ${pkg.view.folder}/, not a folder of this repository; ${view.folder}/ passes it on):\n${renderFolderView(pkg.view, { maxChars: Math.floor(budget * 2 / 3) })}` : ''
    ].join('');
    return {
        relation: 'folderView',
        folder: view.folder,
        found: true,
        files: view.files,
        ...(pkg ? { package: pkg.name } : {}),
        text,
        source: loaded.source,
        freshness
    };
}
