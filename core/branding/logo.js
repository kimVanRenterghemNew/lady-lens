/**
 * The lady-lens logo: a favicon for the web pages and a red banner for the terminal.
 *
 * @module core/branding/logo
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { wordmark } from './wordmark.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RED = '\x1b[38;2;255;30;30m';
const PINK = '\x1b[38;2;255;130;130m';
const WHITE = '\x1b[38;2;255;255;255m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// every icon row is 22 characters wide, so the word beside it lines up
const ICON = [
    '  ▄▄▄▄▄▄▄'.padEnd(22),
    ` █        █${'▄'.repeat(10)}▄`,
    ' █      ▄▄▄▄▄        █',
    ` █    ▄█${WHITE}▀▀${PINK}███${RED}█▄      █`,
    ` █   █${WHITE}█${PINK}███████${RED}██     █`,
    ` █    ▀█${PINK}█████${RED}█▀█▄    █`,
    '  ▀▀▀▀▀▀ ▀▀▀▀▀  ▀█▄ ▀▀'.padEnd(22)
];
const WORD_AT = 2;

const art = version => {
    const word = wordmark();
    return ICON.map((icon, row) => {
        const text = word[row - WORD_AT] ?? '';
        const tag = row === WORD_AT + word.length ? `${DIM}${WHITE}v${version}` : '';
        return `${RED}${icon}  ${text}${tag}${RESET}`;
    });
};

export const faviconPng = () => fs.readFileSync(path.join(HERE, 'favicon.png'));

/** Prints the banner to the stream (nothing when it is not a terminal). */
export function showBanner(stream = process.stdout) {
    const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8'));
    stream.write(banner(pkg.version, stream));
}

/** The banner with the version, or '' when the stream is not a terminal (logs, pipes and tests stay clean). */
export function banner(version, stream = process.stdout) {
    if (!stream.isTTY || process.env.NO_COLOR || process.env.LENS_NO_BANNER) return '';
    return `\n${art(version).join('\n')}\n\n`;
}

/** Sends the favicon (the same file for /favicon.png and /favicon.ico). */
export function sendFavicon(res) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' });
    res.end(faviconPng());
}

/** Sends the vector favicon, which browsers prefer over the png. */
export function sendFaviconSvg(res) {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
    res.end(fs.readFileSync(path.join(HERE, 'favicon.svg')));
}
