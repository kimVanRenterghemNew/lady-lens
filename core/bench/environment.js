/**
 * Where a bench run ran. `machine` is a hash, not the host name: runs from the same machine can be compared, and the
 * file says nothing about who made it.
 */
import crypto from 'crypto';
import os from 'os';

export function benchEnvironment({ lensVersion }) {
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model?.trim() || 'unknown';
    return {
        lensVersion,
        node: process.version,
        platform: process.platform,
        release: os.release(),
        arch: process.arch,
        cpus: cpus.length,
        cpuModel,
        memoryGb: Math.round(os.totalmem() / 1073741824),
        machine: crypto.createHash('sha256').update(`${os.hostname()}|${cpuModel}|${cpus.length}|${process.platform}`).digest('hex').slice(0, 12)
    };
}

/** Fields that must match for two runs to be compared without a warning. */
export const SAME_MACHINE_FIELDS = ['machine', 'platform', 'arch', 'cpus'];

export function differentMachine(a = {}, b = {}) {
    return SAME_MACHINE_FIELDS.filter(field => a[field] !== b[field]);
}
