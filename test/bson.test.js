import { describe, it, expect } from 'vitest';
import { decodeBson, guidOf } from '../core/mendix/index.js';

describe('BSON decoder and guidOf', () => {
    it('guidOf formats 16 bytes as .NET GUID', () => {
        const bytes = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        const guid = guidOf(bytes);
        expect(guid).toBe('03020100-0504-0706-0809-0a0b0c0d0e0f');
    });

    it('decodes document with various primitive BSON types', () => {
        // Document: 4 bytes length, type, name\0, value..., 0x00 end
        const doc = Buffer.concat([
            Buffer.from([0, 0, 0, 0]), // placeholder length
            Buffer.from([0x01]), Buffer.from('num\0'), Buffer.from([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]), // 1.0 double
            Buffer.from([0x02]), Buffer.from('str\0'), Buffer.from([5, 0, 0, 0]), Buffer.from('test\0'), // string 'test'
            Buffer.from([0x08]), Buffer.from('bool\0'), Buffer.from([1]), // boolean true
            Buffer.from([0x10]), Buffer.from('int\0'), Buffer.from([42, 0, 0, 0]), // int32 42
            Buffer.from([0x12]), Buffer.from('big\0'), Buffer.from([100, 0, 0, 0, 0, 0, 0, 0]), // int64 100
            Buffer.from([0x0a]), Buffer.from('nil\0'), // null
            Buffer.from([0x00]) // end of doc
        ]);
        doc.writeInt32LE(doc.length, 0);

        const result = decodeBson(doc);
        expect(result.num).toBe(1.0);
        expect(result.str).toBe('test');
        expect(result.bool).toBe(true);
        expect(result.int).toBe(42);
        expect(result.big).toBe(100);
        expect(result.nil).toBe(null);
    });

    it('decodes nested array and throws on unsupported type', () => {
        const arr = Buffer.concat([
            Buffer.from([0, 0, 0, 0]),
            Buffer.from([0x10]), Buffer.from('0\0'), Buffer.from([7, 0, 0, 0]),
            Buffer.from([0x00])
        ]);
        arr.writeInt32LE(arr.length, 0);

        const doc = Buffer.concat([
            Buffer.from([0, 0, 0, 0]),
            Buffer.from([0x04]), Buffer.from('items\0'), arr,
            Buffer.from([0x00])
        ]);
        doc.writeInt32LE(doc.length, 0);

        const result = decodeBson(doc);
        expect(result.items).toEqual([7]);

        const badDoc = Buffer.from([8, 0, 0, 0, 0x7f, 0x61, 0x00, 0x00]);
        expect(() => decodeBson(badDoc)).toThrow(/unsupported BSON type/);
    });
});
