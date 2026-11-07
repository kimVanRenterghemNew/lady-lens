import { describe, it, expect } from 'vitest';
import {
    JAVASCRIPT_CONFIG, CSHARP_CONFIG, PYTHON_CONFIG, TYPESCRIPT_CONFIG, JAVA_CONFIG, CPP_CONFIG, GO_CONFIG,
    RUST_CONFIG, PHP_CONFIG, RUBY_CONFIG, KOTLIN_CONFIG, SWIFT_CONFIG
} from '../core/graph/sync/languages/index.js';

// name, config, test path, source that marks a test, header comment
const CASES = [
    ['javascript', JAVASCRIPT_CONFIG, 'a.test.js', null, null],
    ['csharp', CSHARP_CONFIG, 'X.Tests/a.cs', '[Test]', '// Header line\n'],
    ['python', PYTHON_CONFIG, 'src/tests/a.py', 'import pytest', '# Header line\n'],
    ['typescript', TYPESCRIPT_CONFIG, 'a.test.ts', 'it(1)', '// Header line\n'],
    ['java', JAVA_CONFIG, 'p/src/test/A.java', '@Test', '// Header line\n'],
    ['cpp', CPP_CONFIG, 'tests/a.cpp', '#include <gtest/gtest.h>', '// Header line\n'],
    ['go', GO_CONFIG, 'a_test.go', 'func TestX(t *testing.T)', '// Header line\n'],
    ['rust', RUST_CONFIG, 'tests/a.rs', '#[test]', '//! Header line\n'],
    ['php', PHP_CONFIG, 'app/tests/a.php', 'class A extends TestCase', '// Header line\n'],
    ['ruby', RUBY_CONFIG, 'spec/a.rb', 'RSpec.describe X', '# Header line\n'],
    ['kotlin', KOTLIN_CONFIG, 'src/test/A.kt', '@Test', '// Header line\n'],
    ['swift', SWIFT_CONFIG, 'FooTests/A.swift', 'class A: XCTestCase', '/// Header line\n']
];

describe.each(CASES)('%s config', (_name, config, testPath, testSource, header) => {
    it('recognises a test file by path', () => {
        expect(config.isTestFile(testPath, 'nothing')).toBe(true);
    });

    it('does not flag a plain source file', () => {
        expect(config.isTestFile('src/main/x.ext', 'nothing')).toBe(false);
    });

    if (testSource) {
        it('recognises a test file by its content', () => {
            expect(config.isTestFile('src/main/x.ext', testSource)).toBe(true);
        });
    }

    if (config.extractPurpose) {
        it('takes the purpose from the header comment', () => {
            expect(config.extractPurpose(`${header}\nfoo`)).toContain('Header line');
        });

        it('has no purpose without a header comment', () => {
            expect(config.extractPurpose('const x = 1;\n')).toBe('');
        });
    }
});

describe('documentation-style purposes', () => {
    it('reads doc blocks in C#, Java, Kotlin, PHP, Python and Rust', () => {
        expect(CSHARP_CONFIG.extractPurpose('/// <summary>\n/// Does it\n/// </summary>\nclass A {}')).toBe('Does it');
        expect(JAVA_CONFIG.extractPurpose('/**\n * Java doc\n */\nclass A {}')).toContain('Java doc');
        expect(KOTLIN_CONFIG.extractPurpose('/**\n * Kdoc\n */\nclass A')).toContain('Kdoc');
        expect(PHP_CONFIG.extractPurpose('<?php\n/**\n * Php doc\n */\nclass A {}')).toContain('Php doc');
        expect(PYTHON_CONFIG.extractPurpose('"""Py doc."""\nimport os')).toContain('Py doc');
        expect(RUST_CONFIG.extractPurpose('//! Crate doc\nfn a() {}')).toContain('Crate doc');
        expect(GO_CONFIG.extractPurpose('// Package doc\npackage a\n')).toContain('Package doc');
    });
});
