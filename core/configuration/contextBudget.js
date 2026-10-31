/**
 * How much one tool answer may hold, so an agent's context stays small. Every tool result goes through `fitToBudget`.
 * Override with LENS_TOOL_RESULT_CHARS, LENS_READ_CHUNK_MAX_CHARS, LENS_READ_CHUNK_MAX_LINES, LENS_GREP_MAX_MATCHES.
 */
import { lensEnv } from './env.js';

const positive = (name, fallback) => {
    const value = Number(lensEnv(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const READ_RESULT_OVERHEAD = 800;

export function contextBudget() {
    const toolResultChars = positive('TOOL_RESULT_CHARS', 4000);
    // Measured in JSON characters (escaped \n, \", \\ included) by read_chunk, so it adds up exactly.
    const readChunkChars = Math.min(positive('READ_CHUNK_MAX_CHARS', 3200), toolResultChars - READ_RESULT_OVERHEAD);
    return {
        toolResultChars,
        readChunkChars,
        readChunkLines: positive('READ_CHUNK_MAX_LINES', 120),
        grepMatches: positive('GREP_MAX_MATCHES', 40)
    };
}
