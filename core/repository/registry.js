/**
 * Repository registry for lady-lens.
 * Manages ~/.lady-lens/repos.json and per-repository database paths.
 *
 * @module core/repository/registry
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const LENS_HOME = process.env.LENS_HOME || path.join(os.homedir(), '.lady-lens');
export const REGISTRY_FILE = path.join(LENS_HOME, 'repos.json');

export function idOfRepo(repoPath) {
    const normalized = path.resolve(repoPath).toLowerCase();
    return crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

export function databasePathOfRepo(repoId) {
    return path.join(LENS_HOME, 'repos', repoId, 'graph.lbdb');
}

export function readRegistry(registryFile = REGISTRY_FILE) {
    try {
        const content = fs.readFileSync(registryFile, 'utf8');
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === 'object' && parsed.repos ? parsed : { repos: {} };
    } catch {
        return { repos: {} };
    }
}

export function writeRegistry(data, registryFile = REGISTRY_FILE) {
    const dir = path.dirname(registryFile);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${registryFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, registryFile);
}

export function listRegisteredRepos(registryFile = REGISTRY_FILE) {
    const registry = readRegistry(registryFile);
    return Object.values(registry.repos || {});
}

export function currentGitBranch(dir) {
    try {
        let gitPath = path.join(dir, '.git');
        if (!fs.existsSync(gitPath)) return null;
        const stat = fs.statSync(gitPath);
        if (stat.isFile()) {
            const gitdirContent = fs.readFileSync(gitPath, 'utf8').trim();
            const match = gitdirContent.match(/^gitdir:\s*(.+)$/i);
            if (match) gitPath = path.resolve(dir, match[1]);
        }
        const headFile = path.join(gitPath, 'HEAD');
        if (fs.existsSync(headFile)) {
            const head = fs.readFileSync(headFile, 'utf8').trim();
            if (head.startsWith('ref: refs/heads/')) return head.replace('ref: refs/heads/', '');
            return head.slice(0, 8);
        }
    } catch {
        // Not a git repo or unreadable
    }
    return null;
}

export function registerRepo(repoPath, extra = {}, registryFile = REGISTRY_FILE) {
    const resolved = path.resolve(repoPath);
    const id = idOfRepo(resolved);
    const registry = readRegistry(registryFile);
    let database = extra.database;
    if (!database && extra.db) {
        const fromReg = registry.repos[extra.db];
        database = fromReg?.database || (extra.db.endsWith('.lbdb') ? path.resolve(extra.db) : databasePathOfRepo(extra.db));
    }
    if (!database) {
        database = databasePathOfRepo(id);
    }
    const branch = extra.branch || currentGitBranch(resolved) || undefined;
    const current = registry.repos[id] || {};
    const updated = {
        ...current,
        id,
        path: resolved,
        database: database || current.database,
        ...(branch ? { branch } : {}),
        ...extra
    };
    delete updated.db;
    registry.repos[id] = updated;
    writeRegistry(registry, registryFile);
    return updated;
}

export function unregisterRepo(idOrPath, registryFile = REGISTRY_FILE) {
    const registry = readRegistry(registryFile);
    let targetId = idOrPath;
    if (!registry.repos[targetId]) {
        targetId = idOfRepo(idOrPath);
    }
    if (registry.repos[targetId]) {
        const removed = registry.repos[targetId];
        delete registry.repos[targetId];
        writeRegistry(registry, registryFile);
        return removed;
    }
    return null;
}

export function resolveRepoTarget(idOrPath, registryFile = REGISTRY_FILE) {
    if (!idOrPath) return null;
    const registry = readRegistry(registryFile);
    if (registry.repos[idOrPath]) return registry.repos[idOrPath];
    const id = idOfRepo(idOrPath);
    if (registry.repos[id]) return registry.repos[id];

    const resolved = path.resolve(idOrPath);
    const byPath = Object.values(registry.repos).find(r => path.resolve(r.path).toLowerCase() === resolved.toLowerCase());
    if (byPath) return byPath;

    return {
        id,
        path: resolved,
        database: databasePathOfRepo(id),
        branch: currentGitBranch(resolved) || undefined
    };
}
