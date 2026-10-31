/**
 * Every setting lady-lens reads from the environment, under one name each: `LENS_<NAME>`. A host application maps
 * its own variable names once, and may give defaults for what it does not set:
 *   configureLensEnv({ GRAPH_DB: 'MYAPP_GRAPH_DB' }, { SETTINGS_PATH: '/repo/configs/settings.yaml' })
 * Read at call time, so a changed variable is seen on the next call.
 */
const aliases = new Map();
const defaults = new Map();

/**
 * @param {Record<string, string>} map - lens name (without `LENS_`) -> the host's variable name
 * @param {Record<string, string>} [fallbacks] - lens name -> value when no variable is set
 */
export function configureLensEnv(map = {}, fallbacks = {}) {
    for (const [name, variable] of Object.entries(map)) aliases.set(name, variable);
    for (const [name, value] of Object.entries(fallbacks)) defaults.set(name, value);
}

/** The variable that holds setting `name` (e.g. 'GRAPH_DB'): the host's mapped name, else `LENS_<name>`. */
export function lensEnvName(name) {
    return aliases.get(name) ?? `LENS_${name}`;
}

/** The value of setting `name` (e.g. 'GRAPH_DB'): the (mapped) variable, else the host's default, else undefined. */
export function lensEnv(name, env = process.env) {
    const value = env[lensEnvName(name)];
    return value === undefined || value === '' ? defaults.get(name) : value;
}
