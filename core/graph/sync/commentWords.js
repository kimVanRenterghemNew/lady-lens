/**
 * The words of a file's comments, beyond its header. A question about behaviour names what the code does in words that
 * stand in its comments ("a loose y or n without an open question"), rarely in its names; the header alone (`purpose`)
 * missed them (backlog/zoeken-op-gedrag.md). Kept as a short list of distinct words, not as text.
 */
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|^[ \t]*#(?![!{])[^\n]*/gm;
const MAX_WORDS = 300;

export function commentWordsOf(source) {
    const words = [...String(source).matchAll(COMMENT)].flatMap(([comment]) => comment.toLowerCase().match(/[a-zà-ÿ]{4,}/g) || []);
    return [...new Set(words)].slice(0, MAX_WORDS);
}
