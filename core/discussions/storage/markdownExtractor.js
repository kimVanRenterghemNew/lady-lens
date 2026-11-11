/**
 * Extractor for markdown discussions.
 *
 * @module core/discussions/storage/markdownExtractor
 */
import fs from 'fs';
import path from 'path';
import { parseDiscussionMarkdown } from '../model/index.js';

/**
 * Scans a folder for discussion markdown files and parses them into discussion records.
 * @param {string} dirPath
 * @returns {Array}
 */
const extractEntry = (entry, dirPath) => {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) return extractDiscussionsFromDirectory(fullPath);
    if (!entry.name.endsWith('.md')) return [];
    try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const parsed = parseDiscussionMarkdown(content, entry.name);
        const isMatch = parsed.tags?.includes('discussion') || entry.name.includes('discussion') || dirPath.includes('discussions');
        return isMatch ? [parsed] : [];
    } catch {
        return [];
    }
};

export function extractDiscussionsFromDirectory(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath, { withFileTypes: true })
        .flatMap(entry => extractEntry(entry, dirPath));
}
