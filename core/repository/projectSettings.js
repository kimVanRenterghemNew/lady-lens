import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import YAML from 'yaml';
import { REPO_ROOT, lensEnv, configureLensEnv } from '../configuration/index.js';

// A repository may describe itself in config.json or .lady-lens.yaml; a host application points elsewhere with SETTINGS_PATH.
const defaultSettingsPath = () => {
    const candidates = [
        path.join(REPO_ROOT, 'config.json'),
        path.join(REPO_ROOT, 'lens.config.json'),
        path.join(REPO_ROOT, '.lady-lens.json'),
        path.join(REPO_ROOT, '.lady-lens.yaml'),
        path.join(REPO_ROOT, '.lady-lens.yml')
    ];
    for (const file of candidates) {
        if (fsSync.existsSync(file)) return file;
    }
    return candidates[0];
};

const DEFAULT_SETTINGS = {
    project: {
        exclude_dirs: ['.git', '.memory', 'node_modules', 'outputs', 'coverage', 'dist', 'build', 'target', '.vs', '.idea'],
        graph_roots: ['.'],
        graph_extensions: ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.cs', '.csproj', '.sln', '.sql', '.ps1', '.md', '.yaml', '.yml', '.json', '.reference']
    },
    graph: {
        freshness: { default_max_age_days: 30 },
        ast: { enabled: true },
        documentation: { enabled: true },
        links: { enabled: true }
    }
};

function settingsPath() {
    return lensEnv('SETTINGS_PATH') || defaultSettingsPath();
}

function parseConfig(content) {
    try {
        return JSON.parse(content);
    } catch {
        return YAML.parse(content) || {};
    }
}

function mergeSettings(base, override) {
    if (override?.env && typeof override.env === 'object') {
        configureLensEnv({}, override.env);
    }
    return {
        ...base,
        ...override,
        project: { ...base.project, ...override?.project },
        graph: { ...base.graph, ...override?.graph },
        mcp: { port: 4318, uiPort: 4317, ...override?.mcp },
        env: { ...override?.env }
    };
}

export async function loadProjectSettings(filePath = settingsPath()) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = parseConfig(content);
        return mergeSettings(DEFAULT_SETTINGS, parsed);
    } catch (error) {
        if (error.code === 'ENOENT') return structuredClone(DEFAULT_SETTINGS);
        throw error;
    }
}

export function normalizeRelativePath(value) {
    return String(value).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

/**
 * Directories that are excluded wherever they appear (dependency/VCS/session folders). Every other
 * `exclude_dirs` entry is anchored at the repository root: `boards` excludes the top-level
 * `boards/` persona config, NOT `core/domain/governance/boards/` (the old
 * "any path segment" rule silently dropped nested folders with a common name (for example personas/ or boards/ deep in the tree)
 * and core/domain/outputs/* from the graph).
 */
export const EXCLUDED_ANYWHERE = new Set(['node_modules', '.git', '.memory']);

// Build output anywhere in the tree (.NET: every project folder has obj/ and bin/Debug|Release). A bin/ that holds code
// (a CLI entry point in a JavaScript repo) is not build output and stays.
const BUILD_OUTPUT = (segments) => segments.includes('obj') || segments.some((segment, i) => segment === 'bin' && /^(debug|release)$/i.test(segments[i + 1] ?? ''));

export function shouldExcludePath(relativePath, excludeDirs = []) {
    const normalized = normalizeRelativePath(relativePath);
    const segments = normalized.split('/');
    if (BUILD_OUTPUT(segments.slice(0, -1))) return true;
    return excludeDirs.some(excluded => {
        const directory = normalizeRelativePath(excluded);
        if (normalized === directory || normalized.startsWith(`${directory}/`)) return true;
        return EXCLUDED_ANYWHERE.has(directory) && segments.includes(directory);
    });
}

/** Synchronous variant for callers that cannot await (repoFileIndex); same merge rules. */
export function loadProjectSettingsSync(filePath = settingsPath()) {
    try {
        const parsed = parseConfig(fsSync.readFileSync(filePath, 'utf8'));
        return mergeSettings(DEFAULT_SETTINGS, parsed);
    } catch (error) {
        if (error.code === 'ENOENT') return structuredClone(DEFAULT_SETTINGS);
        throw error;
    }
}

export function isGraphExtension(filePath, extensions = DEFAULT_SETTINGS.project.graph_extensions) {
    return extensions.includes(path.extname(filePath).toLowerCase());
}

export const _private = { DEFAULT_SETTINGS, mergeSettings, settingsPath };

/**
 * ONE rule for what is searchable, shared by the graph sync, grep/glob and the directory view of /discuss
 * (each had its own list before). Reads the settings once; the returned function judges repo-relative paths.
 */
export function createSearchExcluder(settings = loadProjectSettingsSync()) {
    const excludeDirs = settings.project?.exclude_dirs || [];
    return (relativePath) => shouldExcludePath(relativePath, excludeDirs);
}
