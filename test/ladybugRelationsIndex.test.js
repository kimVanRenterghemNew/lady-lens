/**
 * writing relations took 161 of 174 s of a 25,000-file sync. Inside UNWIND,
 * `MATCH (a:Entity {id: r.from})` does not use the primary-key index (2.5 ms per relation, the same at any batch size);
 * `MATCH (a:Entity) WHERE a.id = r.from` does (8,000 relations: 21,143 ms -> 528 ms). MERGE stays: callers that do not
 * delete first must not get duplicates. Through the real path (repository -> Ladybug adapter), with a recording connection.
 */
import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import { createGraphRepository } from '../core/graph/index.js';

describe('relations are written through the id index', () => {
    it('MUST look up both ends with WHERE <alias>.id = r.<end>, never with an {id: ...} map, and keep MERGE', async () => {
        const statements = [];
        const open = async () => ({ query: async (statement) => { statements.push(statement); return [{ nodes: 0, edges: 0 }]; }, close: async () => {} });
        const repository = createGraphRepository({ databasePath: path.join(os.tmpdir(), `relindex-${process.pid}.lbdb`), open });
        await repository.applyProjectChanges({ upserts: [], relations: [{ from: 'file:a.js', to: 'file:b.js', relation: 'IMPORTS', confidence: 'EXTRACTED' }] });
        const write = statements.find(statement => /RELATES \{relation/.test(statement));
        expect(write).toMatch(/WHERE a\.id = r\.from/);
        expect(write).toMatch(/WHERE b\.id = r\.to/);
        expect(write).not.toMatch(/\{id: r\./);
        expect(write).toMatch(/MERGE \(a\)-\[e:RELATES/);
    });
});
