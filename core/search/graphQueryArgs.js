const SESSION_ID = /^[a-zA-Z0-9._-]+$/;

function isInvalidString(val) {
    return val !== undefined && typeof val !== 'string';
}

function isValidSessionId(sessionId) {
    return typeof sessionId === 'string' && SESSION_ID.test(sessionId);
}

function validateSession(sessionId) {
    if (isValidSessionId(sessionId)) return null;
    return 'sessionId must contain only letters, numbers, dots, dashes, or underscores';
}

function validateInput(args) {
    if (isInvalidString(args.node) || isInvalidString(args.query)) {
        return 'node and query must be strings when provided';
    }
    if (!args.node && !args.query) {
        return 'graph_query requires node or query';
    }
    return null;
}

export function validateQueryArgs(args, sessionId) {
    return validateInput(args) || validateSession(sessionId);
}

export function normalizeQueryArgs(rawArgs) {
    const args = rawArgs || {};
    return { args, sessionId: args.sessionId || 'default' };
}
