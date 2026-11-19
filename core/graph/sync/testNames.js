/**
 * The names of the tests in a test file: what each test says it checks, in words. The name ranking (nameRank.js)
 * gives a code file the words of the tests that cover it (role "test").
 * @module core/graph/sync/testNames
 */

const MAX_NAMES = 200;

/** JavaScript/TypeScript: the title of describe/it/test, any quote style. */
const jsNames = (source) => [...source.matchAll(/\b(?:describe|it|test)(?:\.\w+)?\(\s*(['"`])((?:(?!\1).){1,200})\1/g)].map(m => m[2]);

/** Python: a test function name without its test_ prefix. */
const pyNames = (source) => [...source.matchAll(/\bdef (test_\w+)/g)].map(m => m[1].replace(/^test_/, '').replace(/_/g, ' '));

/** C#: the method under an xUnit, NUnit or MSTest attribute; underscores become spaces. */
const csNames = (source) => [...source.matchAll(/\[(?:Fact|Theory|Test|TestMethod|TestCase|DataTestMethod)\b[^\]]*\][\s\S]{0,300}?\b(?:void|Task|ValueTask)\s+(\w+)\s*\(/g)].map(m => m[1].replace(/_/g, ' '));

/**
 * @param {string} source the text of a test file
 * @returns {string[]} the test names, in source order, at most MAX_NAMES
 */
export function testNamesOf(source) {
    const text = String(source);
    return [...jsNames(text), ...pyNames(text), ...csNames(text)].slice(0, MAX_NAMES);
}
