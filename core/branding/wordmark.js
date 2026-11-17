/**
 * The "lady-lens" word as pixel art: bitmaps of 4x7 pixels, two pixel rows per terminal row (half blocks),
 * so every letter has the same width and the baseline lines up.
 *
 * @module core/branding/wordmark
 */
const GLYPHS = {
    l: ['.X..', '.X..', '.X..', '.X..', '.X..', '.XX.', '....'],
    a: ['....', '....', '.XX.', '...X', '.XXX', 'X..X', '.XXX'],
    d: ['...X', '...X', '.XXX', 'X..X', 'X..X', 'X..X', '.XXX'],
    y: ['....', '....', 'X..X', 'X..X', '.XXX', '...X', '.XX.'],
    '-': ['....', '....', '....', '.XX.', '....', '....', '....'],
    e: ['....', '....', '.XX.', 'X..X', 'XXXX', 'X...', '.XXX'],
    n: ['....', '....', 'XXX.', 'X..X', 'X..X', 'X..X', 'X..X'],
    s: ['....', '....', '.XXX', 'X...', '.XX.', '...X', 'XXX.']
};

const HALF = { 'XX': '█', 'X.': '▀', '.X': '▄', '..': ' ' };

const pixelRow = (word, row) => [...word].map(letter => GLYPHS[letter][row]).join('.');

/** The word as terminal rows (4 rows for 7 pixel rows; the last pixel row pairs with an empty one). */
export function wordmark(word = 'lady-lens') {
    return [0, 2, 4, 6].map(top => {
        const upper = pixelRow(word, top);
        const lower = top + 1 < 7 ? pixelRow(word, top + 1) : '.'.repeat(upper.length);
        return [...upper].map((pixel, at) => HALF[pixel + lower[at]]).join('');
    });
}
