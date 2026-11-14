/**
 * Generates a synthetic repository for scale and bench runs. A profile sets the shape; a fixed seed makes the same
 * repository every time, so two bench runs measure the same thing.
 */
import fs from 'fs';
import path from 'path';

/** shape per profile: files per module, functions per file, imports per file, languages (extensions) */
export const SCALE_PROFILES = Object.freeze({
    default: { count: 500, perModule: 50, functions: 1, imports: 2, languages: ['.js'] },
    'small-files': { count: 3000, perModule: 100, functions: 1, imports: 1, languages: ['.js'] },
    'large-files': { count: 60, perModule: 20, functions: 150, imports: 3, languages: ['.js'] },
    'mixed-languages': { count: 1000, perModule: 50, functions: 3, imports: 2, languages: ['.js', '.ts', '.cs', '.py', '.java'] },
    'many-imports': { count: 1000, perModule: 50, functions: 2, imports: 12, languages: ['.js'] }
});

/** mulberry32: a small seeded random number generator, the same numbers for the same seed */
export function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const FUNCTION_TEXT = {
    '.js': (name, body) => `export function ${name}(value) {\n${body}\n}\n`,
    '.ts': (name, body) => `export function ${name}(value: number): number {\n${body}\n}\n`,
    '.cs': (name, body) => `public static int ${name}(int value) {\n${body}\n}\n`,
    '.py': name => `def ${name}(value):\n    return value + 1\n`,
    '.java': (name, body) => `public static int ${name}(int value) {\n${body}\n}\n`
};
const BODY = (random) => Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) => `    if (value > ${i}) { value = value + ${i}; }`).concat('    return value;').join('\n');

function fileText({ ext, m, f, functions, importTargets, random }) {
    const head = ext === '.js' || ext === '.ts' ? importTargets.map(([om, of]) => `import { func_${om}_${of}_0 } from '../mod_${om}/file_${of}.js';`).join('\n') : '';
    const calls = ext === '.js' ? importTargets.map(([om, of]) => `func_${om}_${of}_0(1);`).join('\n') : '';
    const body = Array.from({ length: functions }, (_, i) => FUNCTION_TEXT[ext](`func_${m}_${f}_${i}`, BODY(random))).join('\n');
    return `// module ${m} file ${f}\n${head}\n\n${body}\n${calls ? `export const wired = () => { ${calls} };\n` : ''}`;
}

function writeTest(dir, m, f) {
    fs.mkdirSync(path.join(dir, 'test', `mod_${m}`), { recursive: true });
    fs.writeFileSync(path.join(dir, 'test', `mod_${m}`, `file_${f}.test.js`), `import { func_${m}_${f}_0 } from '../../src/mod_${m}/file_${f}.js';\nfunc_${m}_${f}_0(1);\n`);
}

function writeDoc(dir, m, f, ext) {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', `doc_${m}_${f}.md`), `# mod_${m} file_${f}\n\nAbout \`func_${m}_${f}_0\` in \`src/mod_${m}/file_${f}${ext}\`.\n`);
}

/** One source file, plus a test for every 5th JavaScript file and a document for every 20th file. */
function writeFile({ dir, m, f, modules, shape, random }) {
    // file_0 of every module is JavaScript: the import target of the others, and the file lens-scale asks about
    const ext = f === 0 ? '.js' : shape.languages[Math.floor(random() * shape.languages.length)];
    const importTargets = Array.from({ length: shape.imports }, () => [Math.floor(random() * modules), 0]).filter(([om]) => om !== m);
    fs.writeFileSync(path.join(dir, 'src', `mod_${m}`, `file_${f}${ext}`), fileText({ ext, m, f, functions: shape.functions, importTargets, random }));
    if (f % 5 === 0 && ext === '.js') writeTest(dir, m, f);
    if (f % 20 === 0) writeDoc(dir, m, f, ext);
}

/** Writes the repository into `dir` and returns `{ files, profile }`. `count` overrides the profile's number of files. */
export function generateScaleRepo({ dir, profile, count, seed }) {
    const shape = SCALE_PROFILES[profile];
    if (!shape) throw new Error(`unknown scale profile "${profile}": ${Object.keys(SCALE_PROFILES).join(', ')}`);
    const total = count || shape.count;
    const random = seededRandom(seed);
    const modules = Math.ceil(total / shape.perModule);
    for (let i = 0; i < total; i++) {
        const [m, f] = [Math.floor(i / shape.perModule), i % shape.perModule];
        if (f === 0) fs.mkdirSync(path.join(dir, 'src', `mod_${m}`), { recursive: true });
        writeFile({ dir, m, f, modules, shape, random });
    }
    return { files: total, profile };
}
