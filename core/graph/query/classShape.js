/**
 * classShape: Extracts inner functions (children) and extending classes (inheritors) for a class symbol.
 */
const fileFunctions = (file) => (Array.isArray(file?.functions) ? file.functions : []);

function isChildFunction(fn, symbol, startLine, endLine) {
    if (fn.name === symbol) return false;
    const loc = fn.loc || [fn.startLine, fn.endLine];
    return loc[0] > startLine && loc[1] <= endLine;
}

export function classShape(definitions, symbol, paths, factsOf) {
    const isClass = definitions.some(({ path }) => factsOf(path)?.text && new RegExp(String.raw`\bclass\s+${symbol.replace(/[$]/g, '\\$')}\b`).test(factsOf(path).text));
    if (!isClass) return {};
    const children = definitions.filter(l => Number.isInteger(l.startLine)).flatMap(({ path, startLine, endLine }) =>
        fileFunctions(factsOf(path)).filter(fn => isChildFunction(fn, symbol, startLine, endLine)).map(fn => ({ name: fn.name, path, line: (fn.loc || [fn.startLine])[0] })));
    const extendsX = new RegExp(String.raw`\bclass\s+([\w$]+)[^{\n]*?(?:extends|:|\()\s*(?:[\w$]+\.)*` + symbol.replace(/[$]/g, '\\$') + String.raw`(?![\w$])`, 'g');
    const inheritors = paths.flatMap(path => [...(factsOf(path)?.text ?? '').matchAll(extendsX)].filter(m => m[1] !== symbol).map(m => ({ name: m[1], path, line: factsOf(path).text.slice(0, m.index).split('\n').length })));
    return { ...(children.length ? { children } : {}), ...(inheritors.length ? { inheritors } : {}) };
}
