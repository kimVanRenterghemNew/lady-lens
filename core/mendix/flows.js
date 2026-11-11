/**
 * The flow of a microflow or nanoflow as a graph: its objects (events, activities, decisions, merges, parameters) as nodes
 * and its sequence flows as edges with their case values. Each node of a before/after pair gets a status from the element
 * diff, so a client can draw both sides and colour what was added, removed or changed.
 * @module core/mendix/flows
 */

const items = list => (Array.isArray(list) ? (typeof list[0] === 'number' ? list.slice(1) : list) : []);
const short = type => String(type || '').split('$').pop();

const CALL_KEYS = ['Microflow', 'Nanoflow', 'JavaScriptAction'];

function directCall(action) {
    const key = CALL_KEYS.find(k => Boolean(action[k]));
    return key ? action[key] : null;
}

function extractCallTarget(action) {
    if (!action) return null;
    if (action.MicroflowCall) return action.MicroflowCall.Microflow;
    if (action.NanoflowCall) return action.NanoflowCall.Nanoflow;
    return directCall(action);
}

function actionVariable(action) {
    if (action.ChangeVariableName) return action.ChangeVariableName;
    return action.VariableName || null;
}

function extractActionTarget(action) {
    if (!action) return null;
    const call = extractCallTarget(action);
    if (call) return call;
    if (action.RetrieveSource) return action.RetrieveSource.Entity;
    return actionVariable(action);
}

function extractNodeTarget(node) {
    const target = extractActionTarget(node.Action);
    if (target) return target;
    return node.SplitCondition ? node.SplitCondition.Expression : null;
}

/** What a node does, in a few words: the called flow, the retrieved entity, the decision's expression. */
export function nodeSummary(node) {
    const action = node.Action;
    const target = extractNodeTarget(node);
    const type = action ? action.$Type : node.$Type;
    return [short(type), target].filter(Boolean).join(': ');
}

/** `{ nodes, edges }` of a flow document, or null when `doc` is no microflow or nanoflow. */
export function flowGraph(doc) {
    if (!doc?.ObjectCollection || !Array.isArray(doc.Flows)) return null;
    const nodes = items(doc.ObjectCollection.Objects).filter(node => node?.$ID).map(node => ({
        id: node.$ID,
        type: node.$Type,
        name: typeof node.Name === 'string' ? node.Name : null,
        caption: typeof node.Caption === 'string' ? node.Caption : null,
        summary: nodeSummary(node)
    }));
    const edges = items(doc.Flows).filter(flow => flow?.OriginPointer && flow?.DestinationPointer).map(flow => ({
        id: flow.$ID,
        type: flow.$Type,
        from: flow.OriginPointer,
        to: flow.DestinationPointer,
        cases: items(flow.CaseValues).map(value => value?.Value ?? short(value?.$Type)).filter(Boolean),
        errorHandler: flow.IsErrorHandler === true
    }));
    return { nodes, edges };
}

/** Before and after graphs of one flow document, every node and edge with its status: added, removed, modified, unchanged. */
export function flowComparison(beforeDoc, afterDoc, changes) {
    const statusOf = new Map(changes.map(change => [change.id, change.change === 'deleted' ? 'removed' : change.change]));
    const mark = graph => graph && {
        nodes: graph.nodes.map(node => ({ ...node, status: statusOf.get(node.id) ?? 'unchanged' })),
        edges: graph.edges.map(edge => ({ ...edge, status: statusOf.get(edge.id) ?? 'unchanged' }))
    };
    const before = mark(flowGraph(beforeDoc));
    const after = mark(flowGraph(afterDoc));
    return before || after ? { before, after } : null;
}
