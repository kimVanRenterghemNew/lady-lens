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

        if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
            const indentMatch = line.match(/^[ \t]*/);
            const lineIndent = indentMatch ? indentMatch[0].length : 0;
            if (lineIndent <= initialIndent) return Math.max(startIndex, currentIndex - 1);
            lastValidIndex = lineEnd;
        } else if (trimmed.length > 0) {
            lastValidIndex = lineEnd;
        }
        if (nextNl === -1) break;
        currentIndex = nextNl + 1;
    }
    return Math.max(startIndex, lastValidIndex);
}