/**
 * The purpose of a JavaScript file: its header comment, said in one line (at most 240 characters).
 * @module core/graph/sync/filePurpose
 */
const MAX_PURPOSE_CHARS = 240;

const docLines = doc => doc.split('\n').map(line => line.replace(/^\s*\* ?/, '').trim());
const slashLines = header => header.split('\n').map(line => line.replace(/^\/\/\s?/, '').trim());

/** The lines of the header: a `//` header at the top wins over a function's doc comment further down; else the first doc comment. */
function headerLines(source) {
    const top = source.replace(/^#!.*\n/, '').replace(/^\s+/, '');
    const lineHeader = top.match(/^(?:\/\/.*(?:\n|$))+/)?.[0];
    if (lineHeader) return slashLines(lineHeader);
    const doc = source.match(/\/\*\*([\s\S]*?)\*\//);
    return doc ? docLines(doc[1]) : [];
}

// a title line ("Mode Classifier (Fase 17, Story 17.1)", "Persona matching (2026-10-03).") names the file but not what it
// does: the paragraph after it does. A name with an aside at its end is a title with or without the period.
const NAME_WITH_ASIDE = /^[^.()]{1,60}\([^()]*\)\.?$/;
const isTitle = paragraph => !paragraph.includes('\n') && (!/[.:;!?]$/.test(paragraph) || NAME_WITH_ASIDE.test(paragraph));

// a long header loses its asides first ("Story 27.51 (a quoted decision of 200 chars): what the file does"), not its end
function withoutAsides(text) {
    let shorter = text;
    while (shorter.length > MAX_PURPOSE_CHARS && /\([^()]*\)/.test(shorter)) shorter = shorter.replace(/\s*\([^()]*\)/, '');
    return shorter;
}

export function extractPurpose(raw) {
    // `.` does not match `\r`: with CRLF line endings a `//` header was never seen
    const lines = headerLines(String(raw).replace(/\r\n?/g, '\n'));
    const [first = '', second] = lines.join('\n').trim().split(/\n\s*\n/).filter(paragraph => !paragraph.startsWith('@'));
    const purpose = isTitle(first) && second ? `${first.replace(/\.$/, '')}: ${second}` : first;
    return withoutAsides(purpose.replace(/\s+/g, ' ')).slice(0, MAX_PURPOSE_CHARS);
}
