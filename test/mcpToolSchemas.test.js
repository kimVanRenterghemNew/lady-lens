import { describe, it, expect } from 'vitest';
import { buildMcpToolSchemas } from '../core/mcp/index.js';

/**
 * MCP clients (VS Code, Copilot) validate the tool schemas strictly and drop a tool that breaks a rule
 * ("tool parameters array type must have items"). These rules apply to every tool lady-lens publishes.
 */
const COMBINATORS = ['oneOf', 'anyOf', 'allOf', 'not', '$ref'];

/** Every problem in one schema node, with its path. */
function problems(node, where) {
    if (node === null || typeof node !== 'object') return [];
    const found = [];
    for (const key of COMBINATORS) if (key in node) found.push(`${where}: '${key}' is not accepted by every client`);
    if (!node.type && !COMBINATORS.some(key => key in node)) found.push(`${where}: no type`);
    if (node.type === 'array') {
        if (!node.items || typeof node.items !== 'object') found.push(`${where}: array without items`);
        else if (!node.items.type) found.push(`${where}.items: no type`);
    }
    if (node.type === 'object' && node.properties) {
        for (const [name, child] of Object.entries(node.properties)) found.push(...problems(child, `${where}.${name}`));
    }
    if (node.items) found.push(...problems(node.items, `${where}.items`));
    if (node.required && !Array.isArray(node.required)) found.push(`${where}: required must be a list`);
    for (const name of node.required || []) if (!node.properties || !(name in node.properties)) found.push(`${where}: required '${name}' is not a property`);
    return found;
}

describe('MCP tool schemas', () => {
    const tools = buildMcpToolSchemas();

    it('publishes tools', () => {
        expect(tools.length).toBeGreaterThan(20);
    });

    it('has a unique name and a description for every tool', () => {
        const names = tools.map(tool => tool.name);
        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
        expect(tools.filter(tool => !tool.description || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name)).map(tool => tool.name)).toEqual([]);
    });

    it('has a parameter schema every client accepts, for every tool', () => {
        const all = tools.flatMap(tool => {
            const parameters = tool.parameters;
            if (parameters?.type !== 'object') return [`${tool.name}: parameters must be an object schema`];
            return Object.entries(parameters.properties || {}).flatMap(([name, child]) => problems(child, `${tool.name}.${name}`))
                .concat((parameters.required || []).filter(name => !(name in (parameters.properties || {}))).map(name => `${tool.name}: required '${name}' is not a property`));
        });
        expect(all).toEqual([]);
    });

    it('the checker itself finds the known mistakes', () => {
        expect(problems({ type: 'array' }, 'x')).toEqual(['x: array without items']);
        expect(problems({ type: 'array', items: { oneOf: [{ type: 'string' }] } }, 'x').join()).toContain("'oneOf'");
        expect(problems({ type: 'array', items: {} }, 'x')).toContain('x.items: no type');
        expect(problems({ type: 'object', properties: { a: { description: 'no type' } }, required: ['b'] }, 'x')).toEqual(['x.a: no type', "x: required 'b' is not a property"]);
    });
});
