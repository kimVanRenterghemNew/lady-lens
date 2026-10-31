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
using Acme.Inventory.Core;

namespace Acme.Inventory.Handlers
{
    /// <summary>
    /// Partial class init
    /// </summary>
    [Handler(HandlerCategory.BasicMethod)]
    public partial class CheckStockForMultipleWarehousesHandlerShell
    {
        private readonly IDestinationService _destinationService;

        public CheckStockForMultipleWarehousesHandlerShell(IDestinationService destinationService)
        {
            _destinationService = destinationService;
        }

        [HandlerEntryPoint]
        private CheckStockForMultipleWarehouses.Response CheckStockForMultipleWarehousesHandler(CheckStockForMultipleWarehouses command)
        {
            Validate(command);
            return _destinationService.Execute(command);
        }

        private void Validate(CheckStockForMultipleWarehouses command)
        {
            if (command == null) throw new ArgumentNullException(nameof(command));
        }
    }
}
`;

const CSHARP_CONTROLLER = `
using Acme.Inventory.Handlers;

namespace Acme.Inventory.Controllers
{
    public class StockController
    {
        private readonly CheckStockForMultipleWarehousesHandler _handler;

        public StockController(CheckStockForMultipleWarehousesHandler handler)
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
using Acme.Inventory.Handlers;

namespace Acme.Inventory.UnitTests
{
    [TestFixture]
    public class CheckStockTests
    {
        [Test]
        public void ShouldHandleStockCheck()
        {
            var handler = new CheckStockForMultipleWarehousesHandler(null);
            handler.Handle(new StockRequest());
        }
    }
}
`;

describe('Story 23.11: Multi-language support (C#)', () => {
    it('analyzes C# source code and extracts classes, methods, symbol ranges, imports, and purpose', () => {
        const facts = analyzeSourceForLanguage(CSHARP_HANDLER, '.cs');
        expect(facts).toBeDefined();
        expect(facts.symbols).toContain('CheckStockForMultipleWarehousesHandlerShell');
        expect(facts.symbols).toContain('CheckStockForMultipleWarehousesHandler');
        expect(facts.symbols).toContain('Validate');
        // Comments like '/// Partial class init' must NOT produce a symbol 'init'
        expect(facts.symbols).not.toContain('init');

        expect(facts.exports).toContain('CheckStockForMultipleWarehousesHandlerShell');
        expect(facts.exports).toContain('CheckStockForMultipleWarehousesHandler');
        expect(facts.exports).not.toContain('init');

        expect(facts.symbolRanges['CheckStockForMultipleWarehousesHandler']).toBeDefined();
        const methodRange = facts.symbolRanges['CheckStockForMultipleWarehousesHandler'];
        expect(methodRange[0]).toBeGreaterThanOrEqual(20);
        expect(methodRange[1]).toBeGreaterThanOrEqual(methodRange[0]);

        expect(facts.imports).toContain('System');
        expect(facts.imports).toContain('Acme.Inventory.Core');
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
        graph.addNode('file:Acme.Inventory/Handlers/CheckStockForMultipleWarehousesHandler.cs', 'CodeFile', {
            path: 'Acme.Inventory/Handlers/CheckStockForMultipleWarehousesHandler.cs',
            kind: 'source',
            lines: 32,
            exports: handlerFacts.exports,
            symbolRanges: handlerFacts.symbolRanges,
            purpose: handlerFacts.purpose
        });

        graph.addNode('file:Acme.Inventory/Controllers/StockController.cs', 'CodeFile', {
            path: 'Acme.Inventory/Controllers/StockController.cs',
            kind: 'source',
            lines: 22,
            exports: controllerFacts.exports,
            symbolRanges: controllerFacts.symbolRanges
        });

        graph.addNode('file:Acme.Inventory.UnitTests/CheckStockTests.cs', 'CodeFile', {
            path: 'Acme.Inventory.UnitTests/CheckStockTests.cs',
            kind: 'test',
            lines: 19,
            exports: testFacts.exports,
            symbolRanges: testFacts.symbolRanges
        });

        // Edges
        graph.addEdge(
            'file:Acme.Inventory/Controllers/StockController.cs',
            'file:Acme.Inventory/Handlers/CheckStockForMultipleWarehousesHandler.cs',
            'CALLS'
        );
        graph.addEdge(
            'file:Acme.Inventory.UnitTests/CheckStockTests.cs',
            'file:Acme.Inventory/Handlers/CheckStockForMultipleWarehousesHandler.cs',
            'TESTS'
        );

        // 1. definedIn check
        const defined = definedIn(graph, 'CheckStockForMultipleWarehousesHandler');
        expect(defined.found).toBe(true);
        expect(defined.locations[0].path).toBe('Acme.Inventory/Handlers/CheckStockForMultipleWarehousesHandler.cs');

        // 2. functionView check
        const view = functionView(graph, 'CheckStockForMultipleWarehousesHandler', {
            readFile: (p) => {
                if (p.includes('CheckStockForMultipleWarehousesHandler')) return CSHARP_HANDLER;
                if (p.includes('StockController')) return CSHARP_CONTROLLER;
                if (p.includes('CheckStockTests')) return CSHARP_TEST;
                return '';
            }
        });

        expect(view.found).toBe(true);
        expect(view.definitions[0].path).toBe('Acme.Inventory/Handlers/CheckStockForMultipleWarehousesHandler.cs');
        expect(view.callers.some(c => c.path.includes('StockController'))).toBe(true);
        expect(view.tests.some(t => t.path.includes('CheckStockTests'))).toBe(true);
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
            const srcDir = path.join(tempDir, 'Acme.Inventory', 'Handlers');
            fs.mkdirSync(srcDir, { recursive: true });
            fs.writeFileSync(path.join(srcDir, 'CheckStockForMultipleWarehousesHandler.cs'), CSHARP_HANDLER, 'utf8');

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
        expect(isConfigFile('Shop.sln')).toBe(true);
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
