// One flow to answer a codebase question: recognise the kind of question, then ask the graph.
import { graph_query } from './graphQuery.js';
import { definedInTool } from './definedIn.js';
import { grep } from './grepSearch.js';
import { read_chunk } from './chunkReader.js';

const IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

/**
 * Centrale query resolver: de graph module bepaalt de executie-strategie.
 *
 * @param {object} req
 * @param {string} [req.query] - Vrije zoekvraag of symboolnaam
 * @param {string} [req.pattern] - Tekst- of regex-patroon
 * @param {string} [req.node] - Graph startknooppunt
 * @param {string} [req.path] - Zoekscope of pad
 * @param {string} [req.sessionId] - Actieve sessie ID
 * @returns {Promise<object>} Geconsolideerd zoekresultaat met line ranges
 */
export async function resolveCodebaseQuery(req = {}) {
    const rawTarget = (req.query || req.pattern || req.node || '').trim();
    if (!rawTarget && !req.node) {
        return { error: 'query, pattern or node is required for codebase search' };
    }

    // Strategie 1: Graph-eerst bij expliciete node of import/graaf traversal
    if (req.node || req.outgoing || req.incoming || req.path?.includes('->')) {
        return graph_query(req);
    }

    // Strategie 2: Is het een JavaScript identifier (functie, klasse, constante)?
    // Vraag eerst de AST/kennisgraaf om directe definitie en export locaties.
    if (IDENTIFIER_RE.test(rawTarget)) {
        try {
            const defined = await definedInTool({ symbol: rawTarget });
            if (defined && !defined.error && defined.found && defined.locations?.length) {
                const primary = defined.locations[0];
                const targetPath = primary.path || primary.file;
                const chunk = read_chunk({
                    path: targetPath,
                    startLine: primary.startLine || 1,
                    endLine: primary.endLine || (primary.startLine ? primary.startLine + 20 : 50)
                });
                return {
                    strategy: 'graph_symbol',
                    symbol: rawTarget,
                    file: targetPath,
                    line: primary.startLine,
                    locations: defined.locations,
                    chunk: chunk.content || '',
                    source: 'graph'
                };
            }
        } catch { /* no symbol answer from the graph: try the next strategy */ }
    }

    // Strategie 3: Algemene graph context query
    try {
        const graphRes = await graph_query({
            query: rawTarget,
            sessionId: req.sessionId || 'default',
            limit: req.limit || 5
        });
        if (graphRes.matchCount > 0 || (graphRes.symbols && graphRes.symbols.length > 0)) {
            return {
                strategy: 'graph_context',
                ...graphRes,
                source: 'graph'
            };
        }
    } catch { /* graph not available: fall back to grep below */ }

    // Strategie 4: Fallback / verfijning via tekstuele grep
    const grepRes = grep({
        pattern: req.pattern || rawTarget,
        path: req.path,
        firstPerFile: req.firstPerFile
    });

    return {
        strategy: 'text_grep',
        ...grepRes,
        source: 'grep'
    };
}
