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
export function extractDiscussionsFromDirectory(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const records = [];

    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            records.push(...extractDiscussionsFromDirectory(fullPath));
        } else if (entry.name.endsWith('.md')) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const parsed = parseDiscussionMarkdown(content, entry.name);
                if (parsed.tags?.includes('discussion') || entry.name.includes('discussion') || dirPath.includes('discussions')) {
                    records.push(parsed);
                }
            } catch {
                // skip malformed markdown
            }
        }
    }

    return records;
}
