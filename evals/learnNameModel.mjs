#!/usr/bin/env node
/**
 * Learn the name model of graph_query's code ranking (core/graph/query/nameModel.js) from the documents of one or more
 * synced repositories: every paragraph that names a code file becomes a pair (the name taken out of the text).
 *
 *   node evals/learnNameModel.mjs --repo <dir>[=<excludeFile>] [--repo …] [--out model.json] [--seed 7] [--held-out 0.3]
 *
 * <dir> is a folder with its lens database at <dir>/.lens-eval.lbdb (the folders evals/behaviourEval.mjs --cache keeps).
 * <excludeFile> lists documents or folders (one per line) that stay out of the training, for example the stories of a
 * repo's own eval cases. Documents are split into training and held-out by a seeded shuffle of their sorted paths, so
 * the same input gives byte-equal weights. The held-out documents compare the learned model with the shipped one.
 */
import fs from 'fs';
import path from 'path';
import { configureLensRoot } from '../core/configuration/index.js';
import { loadGraphModel, invalidateGraphCache } from '../core/search/graphModelLoader.js';
import { rankGraphNodes, nameIndexFor, namePairsFromDocs, nameTrainingExamples, trainNameModel, rankWithNameModel, NAME_MODEL } from '../core/graph/index.js';

const argv = process.argv.slice(2);
const values = (flag) => argv.flatMap((a, i) => (a === flag ? [argv[i + 1]] : []));
const option = (flag, fallback) => values(flag)[0] ?? fallback;
const repos = values('--repo').map(spec => { const [dir, exclude] = spec.split('='); return { dir: path.resolve(dir), exclude: exclude ? fs.readFileSync(exclude, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [] }; });
if (!repos.length) { console.error('usage: node evals/learnNameModel.mjs --repo <dir>[=<excludeFile>] [--repo …] [--out model.json]'); process.exit(2); }
let seed = Number(option('--seed', 7));
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function markdown(dir) {
    const out = [];
    (function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (/^(node_modules|\.git|dist|coverage)$/.test(e.name) || e.name.startsWith('.lens')) continue;
            const full = path.join(d, e.name);
            if (e.isDirectory()) walk(full); else if (/\.md$/i.test(e.name)) out.push({ path: path.relative(dir, full).replace(/\\/g, '/'), text: fs.readFileSync(full, 'utf8') });
        }
    })(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function examplesOf({ dir, exclude }) {
    Object.assign(process.env, { LENS_REPO_ROOT: dir, LENS_GRAPH_DB: path.join(dir, '.lens-eval.lbdb'), LENS_PROJECT_GRAPH: '1' });
    configureLensRoot(dir); invalidateGraphCache();
    const { graph } = await loadGraphModel({ includeProject: true, text: '' });
    const code = [...graph.nodes.values()].filter(n => n.type === 'CodeFile' && n.kind !== 'test');
    const index = nameIndexFor(graph, code); // the index graph_query uses, with the test names of the graph
    const pairs = namePairsFromDocs(markdown(dir), code.map(n => n.path), { exclude });
    const termOrderFor = text => rankGraphNodes(graph, text, { kind: 'code', names: false, limit: 20 }).map(e => e.node);
    console.log(`${dir}: ${code.length} code files, ${new Set(pairs.map(p => p.doc)).size} documents, ${pairs.length} pairs`);
    return nameTrainingExamples(index, pairs, termOrderFor).map(e => ({ ...e, doc: `${path.basename(dir)}:${e.doc}`, index, termOrderFor }));
}

const examples = [];
for (const repo of repos) examples.push(...await examplesOf(repo)); // one after the other: the lens root is process-wide
const docs = [...new Set(examples.map(e => e.doc))].sort().map(d => [d, rnd()]).sort((a, b) => a[1] - b[1]).map(([d]) => d);
const heldOut = new Set(docs.slice(0, Math.round(docs.length * Number(option('--held-out', 0.3)))));
const train = examples.filter(e => !heldOut.has(e.doc)), test = examples.filter(e => heldOut.has(e.doc));
const model = trainNameModel(train);
const again = trainNameModel(train);
console.log(`training: ${train.length} examples, ${model.pairs} positive/negative pairs; a second training gives ${JSON.stringify(again) === JSON.stringify(model) ? 'byte-equal' : 'DIFFERENT'} weights`);
console.log(`weights (standardized): ${model.features.map((f, j) => `${f} ${model.w[j].toFixed(3)}`).join(', ')}`);

const rankOf = (order, files) => Math.min(...files.map(f => (order.indexOf(f) + 1) || 999));
const stat = ranks => `top1 ${ranks.filter(r => r === 1).length}  top3 ${ranks.filter(r => r <= 3).length}  MRR ${(ranks.reduce((a, r) => a + (r < 999 ? 1 / r : 0), 0) / Math.max(1, ranks.length)).toFixed(3)}  (n ${ranks.length})`;
const order = (e, m) => rankWithNameModel(e.index, e.text, { termOrder: e.termOrderFor(e.text), model: m }).map(x => x.node.path);
const shipped = NAME_MODEL.w.length === model.w.length ? `\n  shipped model  ${stat(test.map(e => rankOf(order(e, NAME_MODEL), e.files)))}` : '\n  shipped model  (other features: not comparable)';
console.log(`held-out documents:\n  term order     ${stat(test.map(e => rankOf(e.termOrderFor(e.text).map(n => n.path), e.files)))}${shipped}\n  learned model  ${stat(test.map(e => rankOf(order(e, model), e.files)))}`);
const out = option('--out');
if (out) { fs.writeFileSync(out, `${JSON.stringify(model, null, 1)}\n`); console.log(`model -> ${out}`); }
