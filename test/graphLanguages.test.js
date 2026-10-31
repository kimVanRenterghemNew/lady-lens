import { describe, it, expect } from 'vitest';
import { createGraph, functionView, definedIn } from '../core/graph/index.js';
import {
    analyzeSourceForLanguage,
    isCodeFile,
    isDocFile,
    isConfigFile,
    registerLanguageConfig,
    isLanguageSupported
} from '../core/graph/sync/languages/index.js';

const CSHARP_HANDLER = `
using System;
using System.Collections.Generic;
using Puratos.Opcenter.Core;

namespace Puratos.Opcenter.Handlers
{
    /// <summary>
    /// Partial class init
    /// </summary>
    [Handler(HandlerCategory.BasicMethod)]
    public partial class CheckChangeOverForMultipleDestinationsHandlerShell
    {
        private readonly IDestinationService _destinationService;

        public CheckChangeOverForMultipleDestinationsHandlerShell(IDestinationService destinationService)
        {
            _destinationService = destinationService;
        }

        [HandlerEntryPoint]
        private CheckChangeOverForMultipleDestinations.Response CheckChangeOverForMultipleDestinationsHandler(CheckChangeOverForMultipleDestinations command)
        {
            Validate(command);
            return _destinationService.Execute(command);
        }

        private void Validate(CheckChangeOverForMultipleDestinations command)
        {
            if (command == null) throw new ArgumentNullException(nameof(command));
        }
    }
}
`;

const CSHARP_CONTROLLER = `
using Puratos.Opcenter.Handlers;

namespace Puratos.Opcenter.Controllers
{
    public class ChangeOverController
    {
        private readonly CheckChangeOverForMultipleDestinationsHandler _handler;

        public ChangeOverController(CheckChangeOverForMultipleDestinationsHandler handler)
        {
            _handler = handler;
        }

        public void Process()
        {
            _handler.Handle(null);
        }
    }
}
`;

const CSHARP_TEST = `
using NUnit.Framework;
using Puratos.Opcenter.Handlers;

namespace Puratos.Opcenter.UnitTests
{
    [TestFixture]
    public class CheckChangeOverTests
    {
        [Test]
        public void ShouldHandleChangeOver()
        {
            var handler = new CheckChangeOverForMultipleDestinationsHandler(null);
            handler.Handle(new ChangeOverRequest());
        }
    }
}
`;

describe('Story 23.11: Multi-language support (C#)', () => {
    it('analyzes C# source code and extracts classes, methods, symbol ranges, imports, and purpose', () => {
        const facts = analyzeSourceForLanguage(CSHARP_HANDLER, '.cs');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('CheckChangeOverForMultipleDestinationsHandlerShell');
        expect(facts.symbols).toContain('CheckChangeOverForMultipleDestinationsHandler');
        expect(facts.symbols).toContain('Validate');
        // Comments like '/// Partial class init' must NOT produce a symbol 'init'
        expect(facts.symbols).not.toContain('init');

        expect(facts.exports).toContain('CheckChangeOverForMultipleDestinationsHandlerShell');
        expect(facts.exports).toContain('CheckChangeOverForMultipleDestinationsHandler');
        expect(facts.exports).not.toContain('init');

        expect(facts.symbolRanges['CheckChangeOverForMultipleDestinationsHandler']).toBeDefined();
        const methodRange = facts.symbolRanges['CheckChangeOverForMultipleDestinationsHandler'];
        expect(methodRange[0]).toBeGreaterThanOrEqual(20);
        expect(methodRange[1]).toBeGreaterThanOrEqual(methodRange[0]);

        expect(facts.imports).toContain('System');
        expect(facts.imports).toContain('Puratos.Opcenter.Core');
        expect(facts.purpose).toBe('Partial class init');

        const callees = facts.calls.map(c => c[1]);
        expect(callees).toContain('Validate');
        expect(callees).toContain('Execute');
    });

    it('identifies tests and callers across C# files in functionView', () => {
        const handlerFacts = analyzeSourceForLanguage(CSHARP_HANDLER, '.cs');
        const controllerFacts = analyzeSourceForLanguage(CSHARP_CONTROLLER, '.cs');
        const testFacts = analyzeSourceForLanguage(CSHARP_TEST, '.cs');

        const graph = createGraph('csharp-test');
        graph.addNode('file:Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs', 'CodeFile', {
            path: 'Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs',
            kind: 'source',
            lines: 32,
            exports: handlerFacts.exports,
            symbolRanges: handlerFacts.symbolRanges,
            purpose: handlerFacts.purpose
        });

        graph.addNode('file:Puratos.Opcenter/Controllers/ChangeOverController.cs', 'CodeFile', {
            path: 'Puratos.Opcenter/Controllers/ChangeOverController.cs',
            kind: 'source',
            lines: 22,
            exports: controllerFacts.exports,
            symbolRanges: controllerFacts.symbolRanges
        });

        graph.addNode('file:Puratos.Opcenter.UnitTests/CheckChangeOverTests.cs', 'CodeFile', {
            path: 'Puratos.Opcenter.UnitTests/CheckChangeOverTests.cs',
            kind: 'test',
            lines: 19,
            exports: testFacts.exports,
            symbolRanges: testFacts.symbolRanges
        });

        // Edges
        graph.addEdge(
            'file:Puratos.Opcenter/Controllers/ChangeOverController.cs',
            'file:Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs',
            'CALLS'
        );
        graph.addEdge(
            'file:Puratos.Opcenter.UnitTests/CheckChangeOverTests.cs',
            'file:Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs',
            'TESTS'
        );

        // 1. definedIn check
        const defined = definedIn(graph, 'CheckChangeOverForMultipleDestinationsHandler');
        expect(defined.found).toBe(true);
        expect(defined.locations[0].path).toBe('Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs');

        // 2. functionView check
        const view = functionView(graph, 'CheckChangeOverForMultipleDestinationsHandler', {
            readFile: (p) => {
                if (p.includes('CheckChangeOverForMultipleDestinationsHandler')) return CSHARP_HANDLER;
                if (p.includes('ChangeOverController')) return CSHARP_CONTROLLER;
                if (p.includes('CheckChangeOverTests')) return CSHARP_TEST;
                return '';
            }
        });

        expect(view.found).toBe(true);
        expect(view.definitions[0].path).toBe('Puratos.Opcenter/Handlers/CheckChangeOverForMultipleDestinationsHandler.cs');
        expect(view.callers.some(c => c.path.includes('ChangeOverController'))).toBe(true);
        expect(view.tests.some(t => t.path.includes('CheckChangeOverTests'))).toBe(true);
    });

    it('safely handles unsupported language file as plain text without throwing', () => {
        const text = 'SELECT * FROM users WHERE active = 1;';
        const facts = analyzeSourceForLanguage(text, '.sql');
        expect(facts).toBeDefined();
        expect(facts.symbols).toEqual([]);
        expect(facts.exports).toEqual([]);
        expect(facts.parseError).toBeNull();
    });

    it('indexes C# files through createGraphSync and resolves definitions in the graph', async () => {
        const { createGraphSync } = await import('../core/graph/sync/index.js');
        const fs = await import('fs');
        const os = await import('os');
        const path = await import('path');

        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csharp-sync-test-'));
        try {
            const srcDir = path.join(tempDir, 'Puratos.Opcenter', 'Handlers');
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, 'CheckChangeOverForMultipleDestinationsHandler.cs'), CSHARP_HANDLER, 'utf8');

            const syncer = createGraphSync({ root: tempDir });
            const result = await syncer.sync({ mode: 'full' });
            expect(result.nodes).toBeGreaterThan(0);
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('classifies files using graphify-style file sets and extension detection', () => {
        expect(isCodeFile('src/index.js')).toBe(true);
        expect(isCodeFile('Services/Handler.cs')).toBe(true);
        expect(isCodeFile('main.py')).toBe(true);
        expect(isCodeFile('main.go')).toBe(true);
        expect(isCodeFile('main.rs')).toBe(true);
        expect(isCodeFile('queries/reporting.sql')).toBe(true);
        expect(isCodeFile('scripts/deploy.ps1')).toBe(true);
        expect(isCodeFile('README.md')).toBe(false);

        expect(isDocFile('docs/architecture.md')).toBe(true);
        expect(isDocFile('notes.txt')).toBe(true);
        expect(isDocFile('index.js')).toBe(false);

        expect(isConfigFile('package.json')).toBe(true);
        expect(isConfigFile('sub/dir/package.json')).toBe(true);
        expect(isConfigFile('.lady-lens.yaml')).toBe(true);
        expect(isConfigFile('config.yml')).toBe(true);
        expect(isConfigFile('App.csproj')).toBe(true);
        expect(isConfigFile('Puratos.sln')).toBe(true);
        expect(isConfigFile('data/sample.json')).toBe(false);
    });

    it('supports registering new language configs dynamically without hardcoded extensions', () => {
        const dummyConfig = {
            name: 'rust',
            extensions: ['.rs'],
            extract: () => ({ exports: ['main'], symbols: ['main'] })
        };
        registerLanguageConfig(dummyConfig);
        expect(isLanguageSupported('.rs')).toBe(true);
        expect(isCodeFile('src/main.rs')).toBe(true);
    });
});
