/**
 * A BSON reader for Mendix model units (a .mpr row's Contents, or an .mxunit file). Only the types Mendix writes are read;
 * binary values (the $ID of every element, pointers to other elements) come back as base64 text, so an element and a pointer
 * to it compare as equal strings.
 * @module core/mendix/bson
 */

const CSTRING_END = 0;

function initialContainer(isArray) {
    if (isArray) return [];
    return {};
}

function appendEntry(out, isArray, name, value) {
    if (isArray) {
        out.push(value);
        return;
    }
    out[name] = value;
}

const TYPE_DECODERS = {
    0x01(buf, at) { return { value: buf.readDoubleLE(at), at: at + 8 }; },
    0x02(buf, at) {
        const length = buf.readInt32LE(at);
        return { value: buf.toString('utf8', at + 4, at + 3 + length), at: at + 4 + length };
    },
    0x03(buf, at) { return { value: decodeBson(buf, at, false), at: at + buf.readInt32LE(at) }; },
    0x04(buf, at) { return { value: decodeBson(buf, at, true), at: at + buf.readInt32LE(at) }; },
    0x05(buf, at) {
        const length = buf.readInt32LE(at);
        return { value: buf.toString('base64', at + 5, at + 5 + length), at: at + 5 + length };
    },
    0x06(_buf, at) { return { value: null, at }; },
    0x0a(_buf, at) { return { value: null, at }; },
    0x08(buf, at) { return { value: buf[at] === 1, at: at + 1 }; },
    0x09(buf, at) { return { value: new Date(Number(buf.readBigInt64LE(at))).toISOString(), at: at + 8 }; },
    0x10(buf, at) { return { value: buf.readInt32LE(at), at: at + 4 }; },
    0x12(buf, at) { return { value: Number(buf.readBigInt64LE(at)), at: at + 8 }; }
};

function decodeNextEntry(buffer, at) {
    const type = buffer[at];
    const nameEnd = buffer.indexOf(CSTRING_END, at + 1);
    const name = buffer.toString('utf8', at + 1, nameEnd);
    const decoder = TYPE_DECODERS[type];
    if (!decoder) throw new Error(`unsupported BSON type 0x${type.toString(16)} at byte ${at}`);
    const result = decoder(buffer, nameEnd + 1);
    return { name, value: result.value, at: result.at };
}

/** One BSON document (or array) from `buffer` at `start` to a plain object (or array). */
export function decodeBson(buffer, start, isArray) {
    const offset = start || 0;
    const end = offset + buffer.readInt32LE(offset);
    const out = initialContainer(isArray);
    let at = offset + 4;
    while (at < end - 1) {
        const entry = decodeNextEntry(buffer, at);
        at = entry.at;
        appendEntry(out, isArray, entry.name, entry.value);
    }
    return out;
}

/** A Mendix unit id (16 bytes, .NET GUID byte order) as the GUID text the mprcontents/ file names use. */
export function guidOf(bytes) {
    const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0'));
    return `${hex[3]}${hex[2]}${hex[1]}${hex[0]}-${hex[5]}${hex[4]}-${hex[7]}${hex[6]}-${hex[8]}${hex[9]}-${hex.slice(10).join('')}`;
}
