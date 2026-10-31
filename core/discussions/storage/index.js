/**
 * Discussion storage layer index.
 *
 * @module core/discussions/storage
 */
export {
    saveDiscussion,
    loadDiscussions,
    editDiscussion,
    configureDiscussionSaveHook
} from './discussionStore.js';

export {
    extractDiscussionsFromDirectory
} from './markdownExtractor.js';
