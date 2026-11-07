/**
 * Docker and Container Infrastructure configuration for the multi-language graph extractor.
 * Supports Dockerfiles (multi-stage builds, base images, expose) and Docker Compose files (services, images).
 */
import path from 'path';
import { buildLineOffsets, lineAt } from './engine.js';

export const DOCKER_CONFIG = Object.freeze({
    language: 'docker',
    extensions: ['.dockerfile'],
    fileNames: ['dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'],
    commentPrefixes: ['#'],

    matchesFile(filePath) {
        const base = path.basename(filePath).toLowerCase();
        if (base === 'dockerfile' || base.startsWith('dockerfile.')) return true;
        if (base === 'docker-compose.yml' || base === 'docker-compose.yaml' || base === 'compose.yml' || base === 'compose.yaml') return true;
        return base.endsWith('.dockerfile');
    },

    extract(source, filePath = '') {
        const lineOffsets = buildLineOffsets(source);
        const getLine = (index) => lineAt(source, index, lineOffsets);
        const base = path.basename(filePath).toLowerCase();
        const isCompose = base.includes('compose');

        const result = {
            purpose: '',
            exports: [],
            symbols: [],
            symbolRanges: {},
            imports: [],
            calls: [],
            functions: [],
            parseError: null
        };

        // Header comments as purpose
        const topComments = source.match(/^(?:\s*#[^\n]*\n)+/);
        if (topComments) {
            result.purpose = topComments[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).filter(Boolean).join(' ').slice(0, 240);
        }

        if (isCompose) {
            // Compose services: under `services:` key
            const serviceMatch = source.match(/^services:\s*\n((?:[ \t]+[^\n]*\n?)*)/m);
            if (serviceMatch) {
                const serviceLines = serviceMatch[1];
                const serviceRegex = /^[ \t]{2}([A-Za-z0-9_-]+):/gm;
                for (const sm of serviceLines.matchAll(serviceRegex)) {
                    const svcName = sm[1];
                    result.symbols.push(svcName);
                    result.exports.push(svcName);
                    const line = getLine(source.indexOf(sm[0]));
                    result.symbolRanges[svcName] = [line, line];
                }
            }

            // Image references
            const imageRegex = /^\s*image:\s*['"]?([A-Za-z0-9_./:-]+)['"]?/gm;
            for (const im of source.matchAll(imageRegex)) {
                if (im[1]) result.imports.push(im[1]);
            }
        } else {
            // Dockerfile: FROM <image> [AS <stage>]
            const fromPattern = /^\s*FROM\s+([A-Za-z0-9_./:-]+)(?:\s+AS\s+([A-Za-z0-9_-]+))?/gim;
            for (const match of source.matchAll(fromPattern)) {
                const baseImage = match[1];
                const stageName = match[2];
                if (baseImage) result.imports.push(baseImage);
                if (stageName) {
                    result.symbols.push(stageName);
                    result.exports.push(stageName);
                    const line = getLine(match.index);
                    result.symbolRanges[stageName] = [line, line];
                }
            }

            // Ports: EXPOSE <port>
            const exposePattern = /^\s*EXPOSE\s+([0-9/a-zA-Z\s]+)/gim;
            for (const match of source.matchAll(exposePattern)) {
                const ports = match[1].trim().split(/\s+/);
                for (const p of ports) {
                    const symbol = `port:${p}`;
                    result.symbols.push(symbol);
                    const line = getLine(match.index);
                    if (!result.symbolRanges[symbol]) result.symbolRanges[symbol] = [line, line];
                }
            }

            // Commands: ENTRYPOINT, CMD
            const cmdPattern = /^\s*(?:ENTRYPOINT|CMD)\s+(\[[^\]]+\]|[^\n]+)/gim;
            for (const match of source.matchAll(cmdPattern)) {
                const cmd = match[1].trim().replace(/^\[["']?/, '').replace(/["']?\]$/, '').split(/["']?\s*,\s*["']?/)[0];
                if (cmd && !cmd.startsWith('-')) {
                    result.calls.push(['entrypoint', cmd, getLine(match.index)]);
                }
            }
        }

        result.symbols = [...new Set(result.symbols)];
        result.exports = [...new Set(result.exports)];
        result.imports = [...new Set(result.imports)];

        return result;
    }
});
