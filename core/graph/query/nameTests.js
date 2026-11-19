/**
 * The role test of the name matching: a code file gets the words and neighbour pairs of the names of the tests that
 * cover it (sync stores them as `testNames` on a test file; TESTS edges link it to the code it tests).
 * @module core/graph/query/nameTests
 */

import { wordsAndPairs } from './nameWords.js';

function addFile(postings, feature, node) {
    if (!postings.has(feature)) postings.set(feature, []);
    postings.get(feature).push(node);
}

/**
 * Feature -> the code files whose tests name it.
 * @param {object[]} nodes code files
 * @param {(node: object) => string[]} testNamesOf the test names of a code file
 * @returns {Map<string, object[]>}
 */
export function testPostings(nodes, testNamesOf) {
    const postings = new Map();
    for (const node of nodes) {
        const feats = new Set((testNamesOf(node) ?? []).flatMap(wordsAndPairs));
        feats.forEach(feature => addFile(postings, feature, node));
    }
    return postings;
}

const testedBy = (graph, edge) => (edge.type === 'TESTS' ? graph.nodes.get(edge.from)?.testNames : null);

/**
 * The test names of every code file of a graph: the `testNames` of the test files with a TESTS edge to it.
 * @param {{nodes: Map<string, object>, edges?: object[]}} graph
 * @returns {(node: object) => string[]}
 */
export function graphTestNames(graph) {
    const byTarget = new Map();
    for (const edge of graph.edges ?? []) {
        const names = testedBy(graph, edge);
        if (Array.isArray(names)) byTarget.set(edge.to, [...(byTarget.get(edge.to) ?? []), ...names]);
    }
    return (node) => byTarget.get(node.id) ?? [];
}

function addIdf(vectors, node, key, idf) {
    const vector = vectors.get(node) ?? {};
    vector[key] = (vector[key] ?? 0) + idf;
    vectors.set(node, vector);
}

/**
 * Add the role test to name vectors: words and neighbour pairs of the query as written (no translation), Σ idf over
 * the files whose tests name them.
 * @param {Map<object, object>} vectors from nameVectors, filled in place
 * @param {{tests?: Map<string, object[]>, size: number}} index from buildNameIndex
 * @param {string} text the query
 */
export function addTestVectors(vectors, index, text) {
    const tests = index.tests ?? new Map();
    for (const feature of wordsAndPairs(String(text))) {
        const files = new Set(tests.get(feature) ?? []);
        const idf = Math.log(1 + index.size / Math.max(1, files.size));
        files.forEach(node => addIdf(vectors, node, `${feature[0]}|test`, idf));
    }
}
