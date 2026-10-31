// TODO(coverage): Current line coverage is 5.88% (< 85% target). Raise to >= 85%.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { REPO_ROOT } from '../configuration/index.js';
import {
    createGraph,
    folderView,
    createGraphSync,
    createGraphRepository,
    PROJECT_SCOPE,
    createMemoryRepositoryStore
} from '../graph/index.js';

const PACKAGE_SETTINGS = {
    project: {
        graph_roots: ['.'],
        exclude_dirs: ['node_modules', '.git', 'dist', 'test', 'tests'],
        graph_extensions: ['.js', '.mjs', '.cjs']
    },
    graph: { ast: { enabled: false } }
};

export const readPackageFile = (root, rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
};

export async function packageFolderView(name) {
    let main;
    try {
        main = createRequire(path.join(REPO_ROOT, 'package.json')).resolve(name);
    } catch {
        return null;
    }
    let root = path.dirname(main);
    while (root && !fs.existsSync(path.join(root, 'package.json'))) {
        root = path.dirname(root);
    }
    const repository = createGraphRepository({ store: createMemoryRepositoryStore() });
    await createGraphSync({ root, repository, settings: PACKAGE_SETTINGS, contribute: false }).sync({ mode: 'full' });
    const loaded = await repository.loadGraph({ scopes: [PROJECT_SCOPE] });
    const graph = createGraph(`package:${name}`);
    for (const { id, type, ...data } of loaded.nodes) graph.addNode(id, type, data);
    for (const edge of loaded.edges) {
        graph.addEdge(edge.from, edge.to, edge.type, edge);
    }
    const folder = path.relative(root, path.dirname(main)).split(path.sep).join('/');
    return { name, view: folderView(graph, folder, { readFile: (rel) => readPackageFile(root, rel) }) };
}
