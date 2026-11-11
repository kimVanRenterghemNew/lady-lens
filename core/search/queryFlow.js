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
function getChunkLines(primary) {
    const startLine = Number.isInteger(primary.startLine) ? primary.startLine : 1;
    const endLine = Number.isInteger(primary.endLine) ? primary.endLine : (startLine + 20);
    return { startLine, endLine };
}

function readSymbolChunk(primary) {
    const targetPath = primary.path || primary.file;
    const { startLine, endLine } = getChunkLines(primary);
    const chunk = read_chunk({ path: targetPath, startLine, endLine });
    return { targetPath, startLine, content: chunk && chunk.content ? chunk.content : '' };
}

const isValidSymbolResult = d => Boolean(d && !d.error && d.found && d.locations?.length);

async function tryGraphSymbol(rawTarget) {
    try {
        const defined = await definedInTool({ symbol: rawTarget });
        if (!isValidSymbolResult(defined)) return null;
        const primary = defined.locations[0];
        const { targetPath, startLine, content } = readSymbolChunk(primary);
        return {
            strategy: 'graph_symbol',
            symbol: rawTarget,
            file: targetPath,
            line: startLine,
            locations: defined.locations,
            chunk: content,
            source: 'graph'
        };
    } catch {
        return null;
    }
}

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
        const symbolResult = await tryGraphSymbol(rawTarget);
        if (symbolResult) return symbolResult;
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
