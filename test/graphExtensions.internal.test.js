/**
 * Every programming language lens can parse is indexed by default. 2026-11-13: a Python repository (graphify) gave
 * 0 of 20 behaviour cases, because .py was not in the default graph_extensions although a Python parser exists.
 */
import { describe, it, expect } from 'vitest';
import { _private } from '../core/repository/projectSettings.js';
import { CSHARP_CONFIG } from '../core/graph/sync/languages/csharp.js';
import { JAVASCRIPT_CONFIG } from '../core/graph/sync/languages/javascript.js';
import { PYTHON_CONFIG } from '../core/graph/sync/languages/python.js';
import { TYPESCRIPT_CONFIG } from '../core/graph/sync/languages/typescript.js';
import { JAVA_CONFIG } from '../core/graph/sync/languages/java.js';
import { CPP_CONFIG } from '../core/graph/sync/languages/cpp.js';
import { GO_CONFIG } from '../core/graph/sync/languages/go.js';
import { RUST_CONFIG } from '../core/graph/sync/languages/rust.js';
import { PHP_CONFIG } from '../core/graph/sync/languages/php.js';
import { RUBY_CONFIG } from '../core/graph/sync/languages/ruby.js';
import { KOTLIN_CONFIG, SWIFT_CONFIG } from '../core/graph/sync/languages/kotlinSwift.js';

const PROGRAMMING = [CSHARP_CONFIG, JAVASCRIPT_CONFIG, PYTHON_CONFIG, TYPESCRIPT_CONFIG, JAVA_CONFIG, CPP_CONFIG, GO_CONFIG, RUST_CONFIG, PHP_CONFIG, RUBY_CONFIG, KOTLIN_CONFIG, SWIFT_CONFIG];

describe('default graph extensions', () => {
    it('hold every extension of every programming language lens parses', () => {
        const defaults = _private.DEFAULT_SETTINGS.project.graph_extensions;
        const missing = PROGRAMMING.flatMap(config => config.extensions).filter(ext => !defaults.includes(ext));
        expect(missing).toEqual([]);
    });
});

describe('tests in every language', () => {
    it('a test file is a test in its own language, at the root too; code is not', async () => {
        const { analyzeSourceForLanguage } = await import('../core/graph/sync/languages/index.js');
        const isTest = (file, source = '') => analyzeSourceForLanguage(source, file).isTest;
        expect(isTest('tests/test_export.py')).toBe(true);
        expect(isTest('pkg/store_test.go')).toBe(true);
        expect(isTest('src/test/java/a/StoreTest.java')).toBe(true);
        expect(isTest('Orders/OrderChecks.cs', 'public class OrderChecks { [Fact] public void Works() {} }')).toBe(true);
        expect(isTest('graphify/llm.py', 'def ask():\n    return 1\n')).toBe(false);
        expect(isTest('Orders/OrderHandler.cs', 'public class OrderHandler {}')).toBe(false);
    });
});
