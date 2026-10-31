/**
 * Import cycle detection and shortest loop extraction.
 * - cyclesOf: Tarjan SCC algorithm for import cycles (size > 1).
 * - shortestLoop: BFS to find the shortest circular path in a cycle.
 */

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
                const to = next[i];
                if (!order.has(to)) {
                    order.set(to, index); low.set(to, index++); stack.push(to); onStack.add(to);
                    work.push([to, 0]);
                } else if (onStack.has(to)) low.set(node, Math.min(low.get(node), order.get(to)));
                continue;
            }
            work.pop();
            if (work.length) low.set(work[work.length - 1][0], Math.min(low.get(work[work.length - 1][0]), low.get(node)));
            if (low.get(node) === order.get(node)) {
                const component = [];
                let member;
                do { member = stack.pop(); onStack.delete(member); component.push(member); } while (member !== node);
                if (component.length > 1) cycles.push(component.sort());
            }
        }
    };
    for (const path of paths) if (!order.has(path)) visit(path);
    return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

export function shortestLoop(members, out) {
    const inside = new Set(members);
    let best = null;
    for (const start of members) {
        const previous = new Map([[start, null]]);
        const queue = [start];
        let found = null;
        while (queue.length && !found) {
            const node = queue.shift();
            for (const to of out.get(node) || []) {
                if (!inside.has(to)) continue;
                if (to === start) { found = node; break; }
                if (!previous.has(to)) { previous.set(to, node); queue.push(to); }
            }
        }
        if (!found) continue;
        const path = [];
        for (let node = found; node !== null; node = previous.get(node)) path.unshift(node);
        if (!best || path.length < best.length) best = path;
        if (best.length === 2) break;
    }
    return best ? [...best, best[0]] : [];
}
