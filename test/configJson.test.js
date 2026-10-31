import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    loadProjectSettings,
    loadProjectSettingsSync,
    createGraphSync,
    functionView,
    folderView,
    codeHealth,
    grep,
    glob,
    read_chunk,
    graph_query,
    RESEARCH_TOOLS,
    RESEARCH_TOOL_SCHEMAS,
    createLadyLensMcpServer,
    registerRepo,
    createProfiler
} from '../index.js';
import { configureLensRoot, lensEnv } from '../core/configuration/index.js';

describe('config.json configuration and package API ports', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = path.join(os.tmpdir(), `lens-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        configureLensRoot(tmpDir);
    });

    afterEach(() => {
        configureLensRoot(path.resolve('.'));
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('exports all major API ports from root package entry point', () => {
        expect(typeof createGraphSync).toBe('function');
        expect(typeof functionView).toBe('function');
        expect(typeof folderView).toBe('function');
        expect(typeof codeHealth).toBe('function');
        expect(typeof grep).toBe('function');
        expect(typeof glob).toBe('function');
        expect(typeof read_chunk).toBe('function');
        expect(typeof graph_query).toBe('function');
        expect(typeof createLadyLensMcpServer).toBe('function');
        expect(typeof registerRepo).toBe('function');
        expect(typeof createProfiler).toBe('function');
        expect(typeof RESEARCH_TOOLS).toBe('object');
        expect(Array.isArray(RESEARCH_TOOL_SCHEMAS)).toBe(true);
    });

    it('loads project settings from config.json (async and sync)', async () => {
        const configPath = path.join(tmpDir, 'config.json');
        const customConfig = {
            project: {
                exclude_dirs: ['custom_exclude', 'vendor'],
                graph_roots: ['src'],
                graph_extensions: ['.js', '.ts']
            },
            graph: {
                ast: { enabled: true },
                freshness: { default_max_age_days: 14 }
            },
            mcp: {
                port: 5555,
                uiPort: 5556
            },
            env: {
                TOOL_RESULT_CHARS: '9999',
                DEBUG_LEVEL: '3'
            }
        };

        fs.writeFileSync(configPath, JSON.stringify(customConfig, null, 2), 'utf8');

        const syncSettings = loadProjectSettingsSync(configPath);
        expect(syncSettings.project.exclude_dirs).toEqual(['custom_exclude', 'vendor']);
        expect(syncSettings.project.graph_roots).toEqual(['src']);
        expect(syncSettings.graph.freshness.default_max_age_days).toBe(14);
        expect(syncSettings.mcp.port).toBe(5555);
        expect(syncSettings.mcp.uiPort).toBe(5556);

        // Environment variables defined in config.json should be active in lensEnv
        expect(lensEnv('TOOL_RESULT_CHARS')).toBe('9999');
        expect(lensEnv('DEBUG_LEVEL')).toBe('3');

        const asyncSettings = await loadProjectSettings(configPath);
        expect(asyncSettings.project.exclude_dirs).toEqual(['custom_exclude', 'vendor']);
    });
});
