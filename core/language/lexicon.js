/**
 * Dutch -> English domain lexicon. Requests are often Dutch, the code is English: this bridges the words
 * that matter for finding code ("wachtrij" -> queue, "commando" -> command). Shared by graph ranking (core/graph) and
 * repository research (core/repository) so both find the same files for the same request.
 *
 * Two sources, merged at load:
 *   - HAND_NL_EN below: hand-maintained, always wins;
 *   - configs/lexicon.generated.json: generated from the code's own identifiers by `npm run lexicon:build`
 *     (a small local model proposes Dutch words, validateLexiconEntries keeps only what holds up - see
 *     core/language/lexiconValidation.js). A missing or broken file is no lexicon, never an error.
 *
 * @module core/language/lexicon
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lensEnv } from '../configuration/index.js';

export const GENERATED_LEXICON_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'configs', 'lexicon.generated.json');

export const HAND_NL_EN = {
    sessie: ['session'], sessies: ['sessions'], status: ['state'], wachtrij: ['queue'], veilig: ['safe'], taak: ['task'], taken: ['tasks'],
    bestand: ['file'], bestanden: ['files'], opslaan: ['save', 'store', 'persist'], bewaar: ['save', 'store', 'persist'],
    laden: ['load'], ophalen: ['fetch', 'load'], verwijder: ['delete', 'remove'], verwijderen: ['delete', 'remove'],
    fout: ['error'], fouten: ['errors'], voeg: ['add'], toevoegen: ['add'], commando: ['command'], commandos: ['commands'],
    gebruiker: ['user'], inloggen: ['login'], rechten: ['permission'], instellingen: ['settings', 'config'],
    configuratie: ['config'], afhankelijkheid: ['dependency'], afhankelijkheden: ['dependencies'], uitvoeren: ['execute', 'run'],
    controleren: ['check', 'validate'], valideren: ['validate'], samenvatting: ['summary'], bericht: ['message'],
    huidige: ['current'], toon: ['show', 'print'], toont: ['show', 'print'], tonen: ['show', 'print'], aantal: ['count'], zoeken: ['search', 'find'], vinden: ['find'],
    geheugen: ['memory'], uitvoer: ['output'], invoer: ['input'], weergave: ['view', 'display'], planning: ['plan'],
    onderzoek: ['research'], bewijs: ['evidence'], kennis: ['knowledge'], beslissing: ['decision'], beslissingen: ['decisions']
};

/**
 * Hand lexicon + generated entries. A Dutch word in both keeps the hand translation (the generated words are added
 * after it, without duplicates).
 * @param {{file?: string}} [options]
 * @returns {Object<string, string[]>}
 */
export function loadLexicon({ file = lensEnv('LEXICON_FILE') || GENERATED_LEXICON_FILE } = {}) {
    // No prototype: user words like "constructor" or "tostring" must never find Object.prototype members (live crash 2026-10-10).
    const merged = Object.assign(Object.create(null), Object.fromEntries(Object.entries(HAND_NL_EN).map(([dutch, english]) => [dutch, [...english]])));
    let generated;
    try { generated = JSON.parse(fs.readFileSync(file, 'utf8')).entries || {}; } catch { return merged; }
    for (const [dutch, english] of Object.entries(generated)) {
        if (!/^[a-z]{3,}$/.test(dutch) || !Array.isArray(english)) continue;
        const words = english.filter(word => typeof word === 'string' && /^[a-z]{3,}$/.test(word));
        if (!words.length) continue;
        merged[dutch] = [...new Set([...(merged[dutch] || []), ...words])];
    }
    return merged;
}

// The lexicon in use: read on first use and again when the configured file changes. A host sets its file with
// configureLensEnv AFTER importing lady-lens, so reading it at import time missed the host's file.
let cache = null;
function currentLexicon() {
    const file = lensEnv('LEXICON_FILE') || GENERATED_LEXICON_FILE;
    if (!cache || cache.file !== file) cache = { file, words: loadLexicon({ file }) };
    return cache.words;
}

/** The lexicon in use, as an object (`NL_EN[word]`, `Object.hasOwn`, `Object.keys` all read the current file). */
export const NL_EN = new Proxy(Object.create(null), {
    get: (target, word) => currentLexicon()[word],
    has: (target, word) => word in currentLexicon(),
    ownKeys: () => Reflect.ownKeys(currentLexicon()),
    getOwnPropertyDescriptor: (target, word) => {
        const words = currentLexicon();
        return Object.hasOwn(words, word) ? { value: words[word], enumerable: true, configurable: true, writable: false } : undefined;
    }
});

/** `["wachtrij", "taken"]` -> the words plus their English translations, without duplicates, order kept. */
export function withTranslations(words) {
    const out = [];
    for (const word of words) for (const term of [word, ...(NL_EN[word] || [])]) if (!out.includes(term)) out.push(term);
    return out;
}
