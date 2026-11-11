/**
 * Renders a folder view as formatted text for model prompts.
 */
const list = (items, max = 5) => (items.length > max ? `${items.slice(0, max).join(', ')} (+${items.length - max})` : items.join(', '));

function renderPackagePort(entry, folder, lines) {
    if (entry.package) {
        lines.push(`In this repository ${folder}/ is only this file: a port that passes on the package "${entry.package}" (export * from '${entry.package}'). The modules live in that package, not in ${folder}/ (shown below when available).`);
    }
}

function renderUnusedNotice(usedBy, entry, folder, lines) {
    if (usedBy.files === 0 && !entry?.package) {
        const testNote = usedBy.tests ? ' (only tests)' : '';
        lines.push(`Nothing outside ${folder}/ uses it at runtime${testNote}: it looks unused; new code does not go here unless something wires it in.`);
    }
}

function renderHeaderAndEntry(view, lines) {
    lines.push(`### ${view.folder}/ (${view.files} files, ${view.parts.length} parts)`);
    if (view.entry) {
        const purp = view.entry.purpose ? ` - ${view.entry.purpose}` : '';
        const exp = view.entry.exportCount ? `; exports ${view.entry.exportCount} names (${view.entry.exports.join(', ')})` : '';
        lines.push(`Entry: ${view.entry.path}${purp}${exp}`);
        renderPackagePort(view.entry, view.folder, lines);
    }
    renderUnusedNotice(view.usedBy, view.entry, view.folder, lines);
}

function renderRegisteredItem(item) {
    const at = item.at.length ? ` (${item.at.map(target => `${target.relation} ${target.path}`).join(', ')})` : '';
    const desc = item.description ? `: ${String(item.description).slice(0, 160)}` : '';
    return `Registered as ${item.type} "${item.name}"${at}${desc}`;
}

function renderRegistrations(view, lines) {
    const items = view.registeredAs || [];
    for (const item of items) {
        lines.push(renderRegisteredItem(item));
    }
    const codes = view.registrationCode || [];
    for (const item of codes) {
        lines.push(`How it is registered (the real start of ${item.path}; follow this pattern):`, '```js', item.code, '```');
    }
}

function renderParts(parts, lines) {
    if (!parts.length) return;
    lines.push('', '| part | files | role | key exports |', '|---|---|---|---|');
    for (const part of parts) {
        const role = part.roles.length ? part.roles.map(item => `${item.file}: ${item.purpose.slice(0, part.roles.length > 1 ? 90 : 180)}`).join('; ') : '(no header)';
        lines.push(`| ${part.part} | ${part.files} | ${role.replace(/\|/g, '/')} | ${part.exports.join(', ')}${part.exportCount > part.exports.length ? ` (+${part.exportCount - part.exports.length})` : ''} |`);
    }
}

function renderFlow(flow, lines) {
    if (!flow.length) return;
    lines.push('', 'Flow inside (part -> part it imports/calls):');
    for (const arrow of flow) {
        const details = [arrow.imports && `${arrow.imports} imports`, arrow.calls && `${arrow.calls} calls`].filter(Boolean).join(', ');
        lines.push(`- ${arrow.from} -> ${arrow.to} (${details})`);
    }
}

function renderCallerLine(caller) {
    const pointed = caller.pointedBy.length ? `; ${caller.pointedBy.map(item => `${item.type} "${item.node}" ${item.relation}`).join(', ')}` : '';
    return `- ${caller.path} (${caller.calls} calls)${caller.purpose ? `: ${caller.purpose.slice(0, 200)}` : ''}${pointed}`;
}

function formatReachText(tests) {
    if (tests === null) return 'no tests in this graph, so nothing is known about test reach';
    return `reached by ${tests} test files`;
}

function renderUsedBy(usedBy, lines) {
    const tests = formatReachText(usedBy.tests);
    const folders = usedBy.folders.length ? ` (${usedBy.folders.map(item => `${item.folder} ${item.files}`).join(', ')})` : '';
    lines.push('', `Used from outside by ${usedBy.files} files${folders}; ${tests}.`);
    if (usedBy.callers?.length) {
        lines.push('Called from outside by (where it is wired in):');
        usedBy.callers.forEach(caller => lines.push(renderCallerLine(caller)));
    }
}

function formatCleanFallback(notClean) {
    const testedPrefix = notClean.untested ? 'tests reach every file, ' : '';
    return `Not clean: nothing found (${testedPrefix}no cycles, no boundary violations).`;
}

function collectNotCleanIssues(notClean) {
    const issues = [
        notClean.untested?.length ? `untested: ${list(notClean.untested)}` : null,
        notClean.inCycles.length ? `in import cycles: ${list(notClean.inCycles)}` : null,
        notClean.boundary.length ? `imports past a module's index.js: ${list(notClean.boundary)}` : null
    ];
    return issues.filter(Boolean);
}

function renderNotClean(notClean, lines) {
    const issues = collectNotCleanIssues(notClean);
    if (issues.length) {
        lines.push(`Not clean: ${issues.join('; ')}.`);
        return;
    }
    lines.push(formatCleanFallback(notClean));
}

function clipText(text, maxChars) {
    if (text.length > maxChars) {
        return `${text.slice(0, maxChars)}\n... (clipped at ${maxChars} characters)`;
    }
    return text;
}

/** The view as a text block for a prompt, in the order of a good explanation; clipped to `maxChars` with a note. */
export function renderFolderView(view, options) {
    if (!view) return '';
    if (!view.found) return '';
    const maxChars = options?.maxChars || 3500;
    const lines = [];
    renderHeaderAndEntry(view, lines);
    renderRegistrations(view, lines);
    renderParts(view.parts, lines);
    renderFlow(view.flow, lines);
    renderUsedBy(view.usedBy, lines);
    renderNotClean(view.notClean, lines);

    return clipText(lines.join('\n'), maxChars);
}
