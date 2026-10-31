import { createGraphRepository } from '../graph/index.js';
import { refreshProjectGraph } from './graphModelLoader.js';

export async function definedInTool(args, { refresh = refreshProjectGraph } = {}) {
    const { symbol } = args ?? {};
    if (typeof symbol !== 'string' || !symbol.trim()) {
        return { error: 'symbol is required (an identifier, e.g. "matchesTopics")' };
    }
    const freshness = await refresh();
    const repository = createGraphRepository();
    const locations = await repository.directDefinedIn(symbol.trim());
    return {
        relation: 'definedIn',
        symbol: symbol.trim(),
        found: locations.length > 0,
        locations,
        source: 'ladybug',
        freshness
    };
}
