export const DESIGN_ADVICE = Object.freeze({
    'dispatch-chain': 'opzoektabel of router, zoals toolRoutes.js',
    'fallback-heavy': 'normaliseren aan de rand',
    'deep-nesting': 'vroege return, functie opsplitsen',
    'loop-branching': 'pijplijn of een functie per item',
    'long-condition': 'benoemd predicaat of regeltabel',
    'flag-parameter': 'twee functies, of een strategie meegeven',
    'repeated-literal': 'constante of opsomming',
    'global-mutable-state': 'fabriek met eigen toestand, afhankelijkheid meegeven (zoals createGit)',
    'direct-io': 'poort + adapter + fake (zie core/git)',
    'god-module': 'splitsen langs verantwoordelijkheid',
    'high-cyclomatic-complexity': 'patronen toepassen om complexiteit te verlagen',
    'complexity-above-norm': 'kleine functies, vroege returns of opzoektabel',
    'large-function': 'opsplitsen in kleinere functies',
    'too-many-params': 'optie-object gebruiken'
});

export const adviceFor = (issue) => DESIGN_ADVICE[issue] || 'herstructureer volgens ontwerpregels';

export const childrenOf = node => Object.entries(node).filter(([key]) => key !== 'loc').flatMap(([, child]) => (Array.isArray(child) ? child : [child])).filter(child => Boolean(child && typeof child.type === 'string'));
