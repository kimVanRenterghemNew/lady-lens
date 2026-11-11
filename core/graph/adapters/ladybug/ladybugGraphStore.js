/**
 * Ladybug storage adapter: the ONE persistent graph store ("one graph, typed
 * nodes"). Code files, documents and session governance nodes live in the same Entity table and
 * are told apart by `scope` (`project` or `session:<id>`), so a single query can traverse them.
 *
 * Only this module and `graphRepository.js` know the Ladybug schema; everyone else receives DTOs.
 *
 * Schema version 2: adds `scope` and a `Meta` table. A version-1 database is
 * migrated in place (`ALTER TABLE ... ADD scope`), so an existing `.memory/graph/project.lbdb`
 * keeps working.
 *
 * @module core/graph/ladybugGraphStore
 */
import fs from 'fs/promises';
import path from 'path';
import { Database, Connection } from '@ladybugdb/core';
import { MEMORY_DIR, lensEnv } from '../../../configuration/index.js';
import { writeInBatches } from './writeBatches.js';

export const DEFAULT_LADYBUG_PATH = path.join(MEMORY_DIR, 'graph', 'project.lbdb');
export const SCHEMA_VERSION = '2';
export const CONFIDENCE_VALUES = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'];
const BUFFER_POOL_BYTES = Number(lensEnv('GRAPH_BUFFER_BYTES')) || 1024 * 1024 * 1024;
const MAX_DB_BYTES = Number(lensEnv('GRAPH_MAX_BYTES')) || 4 * 1024 * 1024 * 1024;
const BATCH_SIZE = 1000;

/** Resolved live (not at import), so tests and evals can point each process at its own database. */
export function resolveDatabasePath(explicit) {
    return explicit || lensEnv('GRAPH_DB') || path.join(MEMORY_DIR, 'graph', 'project.lbdb');
}

const ENTITY_COLUMNS = ['id', 'type', 'kind', 'scope', 'path', 'name', 'content_hash', 'documentation', 'metadata_json', 'ast_json', 'created_at', 'updated_at', 'observed_at'];

const SCHEMA_STATEMENTS = [
    `CREATE NODE TABLE Entity(id STRING PRIMARY KEY, type STRING, kind STRING, scope STRING, path STRING, name STRING, content_hash STRING, documentation STRING, metadata_json STRING, ast_json STRING, created_at STRING, updated_at STRING, observed_at STRING)`,
    'CREATE REL TABLE RELATES(FROM Entity TO Entity, relation STRING, confidence STRING, weight DOUBLE, created_at STRING, updated_at STRING)',
    'CREATE NODE TABLE Meta(key STRING PRIMARY KEY, value STRING)'
];

function isAlreadyExistsError(error) {
    return /already exists|already been created|duplicate/i.test(String(error?.message || error));
}

function cypherString(value) {
    return `'${String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Run a statement and ALWAYS close its QueryResult. An unclosed result keeps the native database
 * alive after `close()`, so the write lock stays on the file and the next process (the CLI after a
 * test seeded the graph, or `/plan` after `/graph sync` in another shell) fails with
 * "Could not set lock on file".
 */
async function run(connection, statement, params) {
    let result;
    if (params) {
        const prepared = await connection.prepare(statement);
        result = await connection.execute(prepared, params);
    } else {
        result = await connection.query(statement);
    }
    try {
        return await result.getAll();
    } finally {
        result.close();
    }
}

async function runSchemaStatement(connection, statement) {
    try {
        await run(connection, statement);
    } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
    }
}

async function migrate(connection) {
    for (const statement of SCHEMA_STATEMENTS) {
        await runSchemaStatement(connection, statement);
    }
    // Version 1 databases have Entity without `scope`.
    try {
        await run(connection, "ALTER TABLE Entity ADD scope STRING DEFAULT 'project'");
    } catch (error) {
        if (!/already|exist|duplicate/i.test(String(error?.message || error))) throw error;
    }
    await run(connection, `MERGE (m:Meta {key: 'schema_version'}) SET m.value = '${SCHEMA_VERSION}'`);
}

/**
 * Open the embedded Ladybug graph database.
 * @param {{databasePath?: string, readOnly?: boolean, initialize?: boolean}} [options]
 * @returns {Promise<{databasePath: string, query: (statement: string, params?: object) => Promise<Array<object>>, close: () => Promise<void>}>}
 */
export async function openLadybugGraph(options = {}) {
    const databasePath = resolveDatabasePath(options.databasePath);
    const readOnly = options.readOnly === true;
    const initialize = options.initialize !== false && !readOnly;

    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    // Explicit sizes: the defaults reserve an 8 TB virtual mapping per open, and because every
    // repository call opens/closes the database, repeated opens exhausted the address space
    // ("Mmap for size 8796093022208 failed"). The graph is small; 4 GB is ample headroom.
    const database = new Database(databasePath, BUFFER_POOL_BYTES, true, readOnly, MAX_DB_BYTES);
    const connection = new Connection(database);
    await connection.init();
    if (initialize) await migrate(connection);

    return {
        databasePath,
        query: (statement, params) => run(connection, statement, params),
        close: async () => {
            await connection.close();
            await database.close();
        }
    };
}

/** Normalize an entity DTO into a full row (every column present, so UNWIND batches have one shape). */
export function entityRow(entity) {
    if (!entity?.id || !entity.type) throw new Error('entity requires id and type');
    const row = {
        id: entity.id,
        type: entity.type,
        kind: entity.kind,
        scope: entity.scope || 'project',
        path: entity.path,
        name: entity.name,
        content_hash: entity.contentHash,
        documentation: entity.documentation,
        metadata_json: entity.metadata ? JSON.stringify(entity.metadata) : undefined,
        ast_json: entity.ast ? JSON.stringify(entity.ast) : undefined,
        created_at: entity.createdAt,
        updated_at: entity.updatedAt,
        observed_at: entity.observedAt
    };
    return Object.fromEntries(ENTITY_COLUMNS.map(column => [column, row[column] === undefined || row[column] === null ? '' : String(row[column])]));
}

export function normalizeConfidence(value) {
    if (value === undefined || value === null || value === '') return 'AMBIGUOUS';
    const upper = String(value).toUpperCase();
    if (!CONFIDENCE_VALUES.includes(upper)) throw new Error(`invalid confidence "${value}" (expected ${CONFIDENCE_VALUES.join('/')})`);
    return upper;
}

/** Upsert many entities in one statement. Idempotent: re-indexing a file replaces its row. */
export async function upsertEntities(graph, entities) {
    if (!entities.length) return 0;
    const rows = entities.map(entityRow);
    const assignments = ENTITY_COLUMNS.filter(column => column !== 'id').map(column => `n.${column} = r.${column}`).join(', ');
    return writeInBatches(rows, batch => graph.query(`UNWIND $rows AS r MERGE (n:Entity {id: r.id}) SET ${assignments}`, { rows: batch }), { maxRows: BATCH_SIZE });
}

/** Create many relations in one statement (both endpoints must exist; missing ones are skipped by MATCH). */
export async function createRelations(graph, relations) {
    if (!relations.length) return 0;
    const rows = relations.map(relation => ({
        from: relation.from,
        to: relation.to,
        relation: relation.relation,
        confidence: normalizeConfidence(relation.confidence),
        weight: Number(relation.weight ?? 1),
        created_at: String(relation.createdAt ?? ''),
        updated_at: String(relation.updatedAt ?? relation.createdAt ?? '')
    }));
    return writeInBatches(rows, batch => graph.query(
        // WHERE uses the primary-key index; an {id: r.from} map inside UNWIND scanned every node (8,000 rows: 21 s -> 0.5 s).
        'UNWIND $rows AS r MATCH (a:Entity) WHERE a.id = r.from MATCH (b:Entity) WHERE b.id = r.to '
        + 'MERGE (a)-[e:RELATES {relation: r.relation}]->(b) '
        + 'SET e.confidence = r.confidence, e.weight = r.weight, e.created_at = r.created_at, e.updated_at = r.updated_at',
        { rows: batch }
    ), { maxRows: BATCH_SIZE });
}



export const _private = { cypherString, isAlreadyExistsError, SCHEMA_STATEMENTS, ENTITY_COLUMNS };
