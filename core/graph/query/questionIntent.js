/**
 * Natural language intent recognition for code/graph questions.
 * @module core/graph/query/questionIntent
 */

export const looksLikeRepoPath = (text) => /[\w.-]+\/[\w./-]*\.(?:m?js|cjs|ts|tsx|jsx|json)\b/.test(String(text ?? ''));

const PATH_TOKEN = /[`'"]?((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:m?js|cjs|tsx?|jsx))[`'"]?/;

const STOP_WORDS = new Set([
    'which', 'where', 'what', 'file', 'files', 'module', 'modules', 'defines', 'defined',
    'implemented', 'contains', 'exports', 'function', 'answer', 'repository', 'relative',
    'root', 'welk', 'welke', 'waar', 'bestand', 'wordt', 'gedefinieerd', 'staat', 'functie',
    'exporteert', 'antwoord', 'zoek', 'waarin', 'need', 'path', 'relatief', 'repository-root',
    'repository-relative', 'there', 'implement', 'met', 'het', 'pad', 'aan', 'een', 'van',
    'naar', 'with', 'the'
]);

const LOCATION_INTENT = /\b(?:gedefinieerd|defined?|defines|implemented|ge[iï]mplementeerd|waarin|contains|bevat|zit|staat|exporteert|exports?)\b/i;
const WHICH_FILE = /\b(?:welk(?:e)?|which|waar|where|in\s+welk|bestand|file|module)\b/i;

function isQuestionPrompt(prompt) {
    return /\?|^\s*(?:geef|list|which|welke|wat|staat|is|does|bestaat|what)\b/i.test(prompt);
}

function classifyNonImportRelation(prompt, file) {
    if (/\bnames?\s+(?:can|kan)\s+(?:i|ik)\s+import(?:eren)?\s+(?:from|uit)\b|\bnamen\s+kan\s+ik\s+importeren\b/i.test(prompt)) {
        return { relation: 'exports', file };
    }
    if (!/import|ge[iï]mporteerd/i.test(prompt)) {
        if (/\bexport(?:eert|eren|s|ed)?\b/i.test(prompt)) return { relation: 'exports', file };
        if (/\b(?:staat er|is er|is there|bestaat|exists?|can i open|kan ik)\b|\b(?:yes or no|ja of nee)\b/i.test(prompt)) return { relation: 'exists', file };
    }
    return null;
}

function isGrammaticalSubject(before, after) {
    const trimmedBefore = before.trimEnd();
    if (/\b(?:does|do)\s+$/i.test(trimmedBefore + ' ') && /^\W*\s*(?:\w+\s+)?import\b/i.test(after)) return true;
    if (/\bimports?\b/i.test(after.split(/[.?!]/)[0]) && /\b(?:does|do)\b/i.test(before)) return true;
    return false;
}

function isPrepositionalSubject(before, after) {
    if (/\bdepends?\s+on\b|\bhangt\b.*\baf\b/i.test(before + ' ' + after)) return true;
    if (/\b(?:internal\s+)?imports?\s+(?:of|from)\s*$/i.test(before.trimEnd())) return true;
    if (/\b(?:interne\s+)?imports\s+van\s*$/i.test(before.trimEnd())) return true;
    return /\bimporteert\b/i.test(before) && !/\bwie\s+importeert\b/i.test(before);
}

function isSubjectRelation(before, after) {
    return isGrammaticalSubject(before, after) || isPrepositionalSubject(before, after);
}

function detectImportDirection(before, after) {
    if (isSubjectRelation(before, after)) return 'imports';
    const verbBefore = /\bimporteren\b|\bimport(?:s)?\b|\bgebruikt\b|\buses\b|\bwie importeert\b/i.test(before);
    if (verbBefore || /\b(?:imported|ge[iï]mporteerd)\b/i.test(after)) return 'importedBy';
    return null;
}

function extractImportRelation(prompt, match, file) {
    if (!/import|ge[iï]mporteerd|hangt|depend|gebruikt|uses/i.test(prompt)) return null;
    const before = prompt.slice(0, match.index);
    const after = prompt.slice(match.index + match[0].length);
    const relation = detectImportDirection(before, after);
    return relation ? { relation, file } : null;
}

/**
 * Is this prompt a question about who imports a file / what a file imports?
 * @returns {{relation: 'imports'|'importedBy'|'exports'|'exists', file: string} | null}
 */
export function recognizeImportQuestion(text) {
    const prompt = String(text ?? '');
    const match = prompt.match(PATH_TOKEN);
    if (!match || !isQuestionPrompt(prompt)) return null;
    const file = match[1].replace(/^\.\//, '');
    const directRelation = classifyNonImportRelation(prompt, file);
    if (directRelation) return directRelation;
    return extractImportRelation(prompt, match, file);
}

function filterWords(prompt) {
    const words = (prompt.match(/[A-Za-z_$][\w$]*/g) ?? []).filter(word => word.length >= 3 && !STOP_WORDS.has(word.toLowerCase()));
    const identifiers = words.filter(word => /[a-z][A-Z]|_|\d/.test(word));
    return identifiers.length ? identifiers : words;
}

function extractCandidateSymbols(prompt) {
    const ticked = [...prompt.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map(match => match[1]);
    if (ticked.length) return ticked;
    const named = prompt.match(/\b(?:functie|function|methode|method|class|klasse|constante|const)\s+`?([A-Za-z_$][\w$]*)/i)?.[1];
    if (named) return [named];
    return filterWords(prompt);
}

function isPathLikeOrEmpty(prompt) {
    return !prompt.trim() || looksLikeRepoPath(prompt) || PATH_TOKEN.test(prompt);
}

function hasSymbolQuestionShape(prompt) {
    if (isPathLikeOrEmpty(prompt)) return false;
    if (!/\?|^\s*(?:waar|welk|welke|which|where|in welk)\b/i.test(prompt)) return false;
    return LOCATION_INTENT.test(prompt) && WHICH_FILE.test(prompt);
}

/**
 * Is this prompt "where is the symbol X defined"?
 * @returns {{relation: 'definedIn', symbols: string[]} | null}
 */
export function recognizeSymbolQuestion(text) {
    const prompt = String(text ?? '');
    if (!hasSymbolQuestionShape(prompt)) return null;
    const symbols = [...new Set(extractCandidateSymbols(prompt))];
    return symbols.length ? { relation: 'definedIn', symbols } : null;
}
