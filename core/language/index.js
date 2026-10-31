/** Public API of the language module: the NL->EN lexicon shared by graph ranking and research. */
export { NL_EN, HAND_NL_EN, loadLexicon, withTranslations, GENERATED_LEXICON_FILE } from './lexicon.js';
export { validateLexiconEntries } from './lexiconValidation.js';
export { editDistance, closestWord, editBudget } from './fuzzy.js';
