/**
 * Import cycle detection and shortest loop extraction.
 * - cyclesOf: Tarjan SCC algorithm for import cycles (size > 1).
 * - shortestLoop: BFS to find the shortest circular path in a cycle.
 */

function stepTarjanEdge(node, to, order, low, stack, onStack, work, getNextIndex) {
    if (!order.has(to)) {
        const idx = getNextIndex();
        order.set(to, idx);
        low.set(to, idx);
        stack.push(to);
        onStack.add(to);
        work.push([to, 0]);
        return;
    }
    const val = onStack.has(to) ? order.get(to) : Infinity;
    low.set(node, Math.min(low.get(node), val));
}

function popTarjanComponent(node, stack, onStack, cycles) {
    const component = [];
    let member;
    do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
    } while (member !== node);
    if (component.length > 1) cycles.push(component.sort());
}

function finishTarjanFrame(node, work, low, order, stack, onStack, cycles) {
    work.pop();
    if (work.length) low.set(work[work.length - 1][0], Math.min(low.get(work[work.length - 1][0]), low.get(node)));
    if (low.get(node) === order.get(node)) popTarjanComponent(node, stack, onStack, cycles);
}

export function cyclesOf(paths, out) {
    let index = 0;
    const order = new Map(), low = new Map(), stack = [], onStack = new Set(), cycles = [];
    const visit = (start) => {
        const work = [[start, 0]];
        order.set(start, index); low.set(start, index++); stack.push(start); onStack.add(start);
        while (work.length) {
            const frame = work[work.length - 1];
            const [node, i] = frame;
            const next = [...(out.get(node) || [])];
            if (i < next.length) {
                frame[1]++;
                stepTarjanEdge(node, next[i], order, low, stack, onStack, work, () => index++);
            } else {
                finishTarjanFrame(node, work, low, order, stack, onStack, cycles);
            }
        }
    };
    for (const path of paths) if (!order.has(path)) visit(path);
    return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

function expandLoopStep(node, out, inside, start, previous, queue) {
    const targets = (out.get(node) ?? []).filter(to => inside.has(to));
    for (const to of targets) {
        if (to === start) return node;
        if (!previous.has(to)) {
            previous.set(to, node);
            queue.push(to);
        }
    }
    return null;
}

function findShortestLoopFrom(start, inside, out) {
    const previous = new Map([[start, null]]);
    const queue = [start];
    let found = null;
    while (queue.length && !found) {
        found = expandLoopStep(queue.shift(), out, inside, start, previous, queue);
    }
    if (!found) return null;
    const path = [];
    for (let node = found; node !== null; node = previous.get(node)) path.unshift(node);
    return path;
}

export function shortestLoop(members, out) {
    const inside = new Set(members);
    let best = null;
    for (const start of members) {
        const path = findShortestLoopFrom(start, inside, out);
        if (path && (!best || path.length < best.length)) best = path;
        if (best && best.length === 2) break;
    }
    return best ? [...best, best[0]] : [];
}
