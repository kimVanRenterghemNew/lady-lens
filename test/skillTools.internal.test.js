import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { SKILL_FILE, renderToolList, updateSkill } from '../scripts/update-skill.mjs';
import { buildMcpToolSchemas } from '../core/mcp/index.js';

describe('skills/lady-lens/SKILL.md', () => {
    it('lists every MCP tool lady-lens offers (run `npm run skill` when this fails)', () => {
        const text = fs.readFileSync(SKILL_FILE, 'utf8').replace(/\r\n/g, '\n');
        expect(updateSkill(text)).toBe(text);
        for (const { name } of buildMcpToolSchemas()) expect(text).toContain(`\`${name}(`);
    });

    it('renders required parameters first, optional ones with ?, and the whole description on one line', () => {
        const list = renderToolList([{ name: 't', description: 'Does a thing.\n  More detail.', parameters: { properties: { a: {}, b: {}, repo: {} }, required: ['b'] } }]);
        expect(list).toContain('- `t(b, a?)`: Does a thing. More detail.');
    });

    it('keeps the hand-written part and replaces only the generated part', () => {
        const once = updateSkill('# Workflow\n', 'LIST');
        expect(once).toBe('# Workflow\n\nLIST\n');
        const real = renderToolList([]);
        const withList = updateSkill('# Workflow\n', real);
        expect(updateSkill(withList, real)).toBe(withList);
    });
});
