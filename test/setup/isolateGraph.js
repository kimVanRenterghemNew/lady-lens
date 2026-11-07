// Every vitest worker gets its own Ladybug database, so no test opens a real graph and parallel workers never share a
// file lock. Every LENS_* variable of the shell is dropped first: a test that needs one sets it itself.
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';
import { workerTempFiles, removeWorkerTemp } from './tempCleanup.js';

const KEEP = new Set(['LENS_PROJECT_GRAPH']); // comes from vitest.config.js (env)
for (const key of Object.keys(process.env)) if (/^LENS_/.test(key) && !KEEP.has(key)) delete process.env[key];

const temp = workerTempFiles();
process.env.LENS_GRAPH_DB = temp.graph;
// Own lens home: daemon.json, the registry and the databases of the developer's running lens are never read or changed.
process.env.LENS_HOME = temp.home;
// Tests use the hand lexicon only, so a generated lexicon file never changes their outcome.
process.env.LENS_LEXICON_FILE = path.join(os.tmpdir(), 'lens-test-no-generated-lexicon.json');
try { afterAll(() => removeWorkerTemp(temp)); } catch { process.on('exit', () => removeWorkerTemp(temp)); } // outside a vitest run (setupIsolation spawns this file in plain node)
