import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT, relativeToRepo, resolveInRepo } from '../../configuration/index.js';
import { createGraphSync, isConfigFile } from '../../graph/index.js';
import { grep } from '../../search/index.js';

const hashOf = content => crypto.createHash('sha256').update(content).digest('hex');
const escaped = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function configGrep(args = {}) {
    // filter while searching: filtering afterwards lost every config match past the first page of code matches
    const result = grep(args, { root: REPO_ROOT, acceptFile: isConfigFile });
    if (result.error) return result;
    const matches = result.matches;
    return {
        matches,
        totalCount: result.totalCount,
        truncated: result.truncated,
        ...(result.offset === undefined ? {} : { offset: result.offset })
    };
}

export function configReferences({ reference, package: packageName, path: scopePath, ignoreCase = true } = {}) {
    reference = reference || packageName;
    if (typeof reference !== 'string' || reference.trim() === '') return { error: 'reference is required' };
    const result = configGrep({ pattern: escaped(reference), path: scopePath, ignoreCase, firstPerFile: true });
    if (result.error) return result;
    const namePattern = new RegExp(`<functionalblock\\b[^>]*>[\\s\\S]*?<name>\\s*${escaped(reference)}\\s*<\\/name>[\\s\\S]*?<version>\\s*([^<]+?)\\s*<\\/version>`, ignoreCase ? 'i' : '');
    const packageVersionPattern = new RegExp(`${escaped(reference)}_(\\d+(?:\\.\\d+)+)`, ignoreCase ? 'i' : '');
    const matches = result.matches.map(match => {
        let source = '';
        const absolute = resolveInRepo(match.file);
        try { source = absolute ? fs.readFileSync(absolute, 'utf8') : ''; } catch { /* grep already found the line */ }
        const functionalMatch = source.match(namePattern);
        const packageMatch = source.match(packageVersionPattern);
        const referenceType = functionalMatch || path.basename(match.file).toLowerCase() === 'packages.reference'
            ? 'functionalblock'
            : /ProjectReference/i.test(match.text) ? 'project' : 'package';
        return { ...match, referenceType, ...(functionalMatch?.[1] || packageMatch?.[1] ? { version: functionalMatch?.[1] || packageMatch?.[1] } : {}) };
    });
    return { reference, matches, totalCount: matches.length, truncated: result.truncated };
}

export async function configUpdate({ path: relativePath, content, expectedHash } = {}) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') return { error: 'path is required' };
    if (typeof content !== 'string') return { error: 'content is required and must be a string' };
    const absolutePath = resolveInRepo(relativePath);
    if (!absolutePath) return { error: `unsafe path: ${relativePath}` };
    if (!isConfigFile(relativePath)) return { error: `not a supported config file: ${relativePath}` };
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) return { error: `path does not exist: ${relativePath}` };

    const before = fs.readFileSync(absolutePath, 'utf8');
    const previousHash = hashOf(before);
    if (expectedHash !== undefined && expectedHash !== previousHash) {
        return { error: 'config changed since read', expectedHash, actualHash: previousHash };
    }
    fs.writeFileSync(absolutePath, content, 'utf8');
    const updatedHash = hashOf(content);
    const sync = await createGraphSync({ root: REPO_ROOT }).touch([path.relative(REPO_ROOT, absolutePath)]);
    return { path: relativeToRepo(absolutePath), previousHash, hash: updatedHash, bytes: Buffer.byteLength(content), sync };
}
