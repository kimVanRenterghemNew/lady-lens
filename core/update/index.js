// lens update and the Node lens runs on: nothing of the graph is imported here, so these processes hold no native module open.
export { runLensUpdate, updateSpec, runCommand } from './lensUpdate.js';
export { chosenNode, lensNodeCommand, settingsFile } from './lensNode.js';
