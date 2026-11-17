// What the Repos tab shows and changes of one repository's own settings: its top-level folders with the number of files
// lens indexes in each, and the `project.exclude_dirs` of its config file (`.lady-lens.json` when it has none yet).
import fs from 'fs';
import path from 'path';
import { loadProjectSettings, scanGraphFiles } from '../core/repository/index.js';

const NAMES = ['config.json', 'lens.config.json', '.lady-lens.json', '.lady-lens.yaml', '.lady-lens.yml'];
const DEFAULT_FILE = '.lady-lens.json';
const MAX_DIRS = 200;

const configFile = root => NAMES.find(name => fs.existsSync(path.join(root, name)));

const topFolders = root => fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== '.git').map(e => e.name);

const countByFolder = (root, files) => files.reduce((counts, file) => {
    const top = path.relative(root, file).split(path.sep)[0];
    return counts.set(top, (counts.get(top) || 0) + 1);
}, new Map());

/** The config file, the excluded folders and every top-level folder with its indexed files. */
export async function readConfig(repo) {
    if (!fs.existsSync(repo.path)) return { error: 'the folder of this repository is missing' };
    const file = configFile(repo.path), settings = await loadProjectSettings(path.join(repo.path, file || DEFAULT_FILE));
    const excluded = settings.project.exclude_dirs, counts = countByFolder(repo.path, await scanGraphFiles({ rootDir: repo.path, settings }));
    const folders = topFolders(repo.path).map(name => ({ name, files: counts.get(name) || 0, excluded: excluded.includes(name) }));
    const { graph_roots, graph_extensions } = settings.project;
    return { file: file || DEFAULT_FILE, exists: Boolean(file), exclude_dirs: excluded, graph_roots, graph_extensions, folders };
}

const validList = list => Array.isArray(list) && list.length <= MAX_DIRS && list.every(d => typeof d === 'string' && d.length > 0 && d.length < 200 && !d.includes('..'));
const FIELDS = ['exclude_dirs', 'graph_roots', 'graph_extensions'];

const readJson = target => {
    try { return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {}; } catch { return null; }
};

const pickFields = values => Object.fromEntries(FIELDS.filter(f => values[f] !== undefined).map(f => [f, values[f]]));
const validPick = picked => Object.keys(picked).length > 0 && Object.values(picked).every(validList);

/** Writes the given `project` lists (exclude_dirs, graph_roots, graph_extensions) into the repository's JSON config; YAML is left to the owner. */
export function writeConfig(repo, values) {
    const picked = pickFields(values);
    if (!validPick(picked)) return { error: 'settings must be lists of folder names or extensions' };
    const file = configFile(repo.path) || DEFAULT_FILE, target = path.join(repo.path, file), current = readJson(target);
    if (!file.endsWith('.json')) return { error: `${file} is YAML: change that file yourself` };
    if (!current) return { error: `${file} is not valid JSON` };
    fs.writeFileSync(target, JSON.stringify({ ...current, project: { ...current.project, ...picked } }, null, 2) + '\n');
    return { saved: file };
}
