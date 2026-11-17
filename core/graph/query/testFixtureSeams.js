/**
 * Test mock and fixture seam extraction for functionView.
 * Extracts `vi.mock` / `jest.mock` statements and context fixture declarations.
 * @module core/graph/query/testFixtureSeams
 */

const QUOTES = new Set(["'", '"', '`']);

function updateQuoteState(ch, inQuote) {
    if (inQuote) return ch === inQuote ? null : inQuote;
    return QUOTES.has(ch) ? ch : null;
}

function updateParenDepth(ch, inQuote, depth) {
    if (inQuote) return depth;
    if (ch === '(') return depth + 1;
    if (ch === ')') return depth - 1;
    return depth;
}

function findCallEnd(text, openIndex) {
    let depth = 0, inQuote = null, escape = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        inQuote = updateQuoteState(ch, inQuote);
        depth = updateParenDepth(ch, inQuote, depth);
        if (depth === 0) return i + 1;
    }
    return -1;
}

export function extractTestMocks(text) {
    if (!text || typeof text !== 'string') return [];
    const mocks = [];
    const mockRe = /\b(?:vi|jest)\.mock\s*\(/g;
    for (const match of text.matchAll(mockRe)) {
        const parenIdx = match.index + match[0].length - 1;
        const end = findCallEnd(text, parenIdx);
        if (end !== -1) mocks.push(text.slice(match.index, end).trim());
    }
    return mocks;
}

const CTX_RE = /(?:const|let|var)\s+(?:ctx|context)\s*=\s*/;
const QUEUE_RE = /(?:const|let|var)\s+QUEUE\s*=\s*\[[\s\S]*?\];/;

function sliceStatement(text, start) {
    const semi = text.indexOf(';', start);
    const end = semi === -1 ? text.length : semi + 1;
    return text.slice(start, end).trim();
}

function attachQueueSnippet(snippet, text) {
    if (!snippet.includes('QUEUE')) return snippet;
    const qMatch = text.match(QUEUE_RE);
    return qMatch ? `${qMatch[0]}\n${snippet}` : snippet;
}

export function extractTestFixture(text) {
    if (typeof text !== 'string') return null;
    const match = text.match(CTX_RE);
    if (!match) return null;
    const snippet = sliceStatement(text, match.index);
    return attachQueueSnippet(snippet, text);
}

export function extractTestMetadata(text) {
    if (!text || typeof text !== 'string') return {};
    const mocks = extractTestMocks(text);
    const fixture = extractTestFixture(text);
    return {
        ...(mocks.length ? { mocks } : {}),
        ...(fixture ? { fixture } : {})
    };
}
