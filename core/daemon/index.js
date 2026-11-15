/**
 * The background daemon's bookkeeping (daemon.json, PIDs, ports): light on purpose, so `lens ps|status|stop` do not
 * load the rest of lady-lens (595 ms of `lens status`, trace 2026-11-15).
 * @module core/daemon
 */
export {
    DAEMON_FILE,
    writeDaemonInfo,
    readDaemonInfo,
    clearDaemonInfo,
    stopDaemon,
    daemonCommand,
    addDaemonPid,
    listDaemonProcesses,
    stopDaemonPid,
    isProcessRunning,
    arePortsBusy,
    existingDaemonMessage,
    parseListening
} from './daemon.js';
