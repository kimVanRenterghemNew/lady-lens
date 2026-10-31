// TODO(coverage): Current line coverage is 20% (< 85% target). Raise to >= 85%.
import { createGraphRepository } from '../graph/index.js';
import { refreshProjectGraph } from './graphModelLoader.js';

const MAX_IMPORT_LIST = 200;

export async function graphFactTool(relation, args, { refresh = refreshProjectGraph } = {}) {
    const { file } = args ?? {};
    if (typeof file !== 'string' || !file.trim()) {
        return { error: 'file is required (repo-relative path, e.g. "core/configuration/index.js")' };
    }
    const freshness = await refresh();
    const repository = createGraphRepository();
    if (relation === 'exports') {
        const answer = await repository.directExports(file);
        if (!answer.found) {
            return {
                error: `${file} is not in the project graph.${answer.candidates.length ? ` Ambiguous: ${answer.candidates.join(', ')}.` : ' Check the path with glob.'}`,
                candidates: answer.candidates,
                freshness
            };
        }
        return {
            file: answer.file,
            relation,
            count: answer.names.length,
            names: answer.names.slice(0, MAX_IMPORT_LIST),
            truncated: answer.names.length > MAX_IMPORT_LIST,
            source: 'ladybug',
            freshness
        };
    }
    const answer = await repository.directExists(file);
    return { relation, ...answer, source: 'ladybug', freshness };
}

export const exportsTool = (args, deps) => graphFactTool('exports', args, deps);
export const fileExists = (args, deps) => graphFactTool('exists', args, deps);
