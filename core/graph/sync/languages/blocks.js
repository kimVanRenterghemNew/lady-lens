const indentOf = (line) => {
    const match = line.match(/^[ \t]*/);
    return match ? match[0].length : 0;
};

const isCommentLine = (trimmed) => trimmed.startsWith('#') || trimmed.startsWith('//');
const isBlockBoundary = (line, trimmed, initialIndent) => Boolean(trimmed) && !isCommentLine(trimmed) && indentOf(line) <= initialIndent;

export function findIndentedBlockEnd(source, startIndex) {
    const lineStart = source.lastIndexOf('\n', startIndex) + 1;
    const initialIndentMatch = source.slice(lineStart).match(/^[ \t]*/);
    const initialIndent = initialIndentMatch ? initialIndentMatch[0].length : 0;

    let currentIndex = source.indexOf('\n', lineStart);
    if (currentIndex === -1) return source.length - 1;
    currentIndex += 1;
    let lastValidIndex = currentIndex;
    while (currentIndex < source.length) {
        const nextNl = source.indexOf('\n', currentIndex);
        const lineEnd = nextNl === -1 ? source.length : nextNl;
        const line = source.slice(currentIndex, lineEnd);
        const trimmed = line.trim();

        if (isBlockBoundary(line, trimmed, initialIndent)) return Math.max(startIndex, currentIndex - 1);
        if (trimmed) lastValidIndex = lineEnd;
        if (nextNl === -1) break;
        currentIndex = nextNl + 1;
    }
    return Math.max(startIndex, lastValidIndex);
}