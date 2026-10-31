// TODO(coverage): Current line coverage is 70% (< 85% target). Raise to >= 85%.
import { contextBudget } from '../configuration/index.js';
import { createGraphRepository, renderScopeInterfaces, scopeInterfaces, importersOf, importsOf } from '../graph/index.js';
import { refreshProjectGraph, loadGraphModel } from './graphModelLoader.js';

const MAX_IMPORT_LIST = 200;

export async function importLookupTool(relation, lookup, args, { refresh = refreshProjectGraph } = {}) {
    const { file } = args ?? {};
    if (typeof file !== 'string' || !file.trim()) {
        return { error: 'file is required (repo-relative path, e.g. "core/configuration/index.js")' };
    }
    const freshness = await refresh();
    const repository = createGraphRepository();
    const answer = relation === 'importedBy' ? await repository.directImportedBy(file) : await repository.directImports(file);
    if (!answer.found) {
        const hint = answer.candidates.length ? ` Ambiguous: ${answer.candidates.join(', ')}.` : ' Check the path with glob.';
        return { error: `${file} is not in the project graph.${hint}`, candidates: answer.candidates, freshness };
    }
    const truncated = answer.files.length > MAX_IMPORT_LIST;
    return {
        file: answer.file,
        relation,
        count: answer.files.length,
        files: answer.files.slice(0, MAX_IMPORT_LIST),
        truncated,
        source: 'ladybug',
        freshness
    };
}

export const importedBy = (args, deps) => importLookupTool('importedBy', importersOf, args, deps);
export const imports = (args, deps) => importLookupTool('imports', importsOf, args, deps);

export async function interfacesForScope({ files = [], maxChars } = {}, { refresh = refreshProjectGraph } = {}) {
    if (!files.length) return '';
    try {
        await refresh();
        const loaded = await loadGraphModel({ sessionId: 'default', text: '', includeProject: true, includeDocs: false });
        return renderScopeInterfaces(scopeInterfaces(loaded.graph, files), { maxChars: maxChars ?? Math.min(3000, contextBudget().readChunkChars) });
    } catch {
        return '';
    }
}
