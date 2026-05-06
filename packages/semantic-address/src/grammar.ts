/**
 * Constrained semantic grammar for memory addressing.
 *
 * Every memory is described by up to 5 facets in strict order.
 * Missing facets produce shorter (partial) addresses.
 */

/** The five facet levels in canonical order (coarsest → finest). */
export const FACET_ORDER = ['domain', 'entity', 'relation', 'temporal', 'qualifier'] as const;
export type Facet = (typeof FACET_ORDER)[number];

/**
 * A semantic grammar descriptor. Each facet is optional.
 * Values can be single strings or arrays (multi-value → sorted and joined).
 *
 * Examples:
 *   { domain: 'reasoning', entity: 'route-planning', relation: 'depends-on', temporal: 'recent' }
 *   { domain: 'conversation', entity: 'user:alice', relation: 'discussed', qualifier: 'high-priority' }
 *   { domain: 'perception', entity: 'sensor:lidar' }  // partial — only 2 levels
 */
export interface SemanticGrammar {
  domain?: string | string[];
  entity?: string | string[];
  relation?: string | string[];
  temporal?: string | string[];
  qualifier?: string | string[];
}

/**
 * Normalize a semantic grammar into a deterministic canonical string.
 *
 * Rules:
 *   1. Facets are emitted in FACET_ORDER (domain first, qualifier last)
 *   2. Each value is lowercased, trimmed, whitespace-collapsed to single space
 *   3. Multi-value arrays are sorted lexicographically and joined with ","
 *   4. Each present facet is encoded as "facet=value"
 *   5. Facets are joined with ">"
 *   6. Missing/empty facets are skipped (they produce a shorter prefix)
 *
 * Returns: [normalizedString, depth] where depth is how many facets are present (1-5).
 */
export function normalize(grammar: SemanticGrammar): [string, number] {
  const parts: string[] = [];

  for (const facet of FACET_ORDER) {
    const raw = grammar[facet];
    if (raw === undefined || raw === null) continue;

    const values = Array.isArray(raw) ? raw : [raw];
    const normalized = values
      .map(v => v.toLowerCase().trim().replace(/\s+/g, ' '))
      .filter(v => v.length > 0)
      .sort();

    if (normalized.length === 0) continue;
    parts.push(`${facet}=${normalized.join(',')}`);
  }

  return [parts.join('>'), parts.length];
}

/**
 * Parse a natural language description into a SemanticGrammar.
 * Uses keyword extraction and pattern matching to assign facets.
 *
 * This is a heuristic parser — for precise addressing, construct the grammar directly.
 */
export function parseDescription(text: string): SemanticGrammar {
  const lower = text.toLowerCase().trim();
  const grammar: SemanticGrammar = {};

  // Domain detection — broad categories
  const domainPatterns: [RegExp, string][] = [
    [/\b(reason|think|logic|infer|deduc|plan)\w*/i, 'reasoning'],
    [/\b(convers|chat|discuss|talk|said|spoke)\w*/i, 'conversation'],
    [/\b(percei|sens|observ|detect|see|hear|feel)\w*/i, 'perception'],
    [/\b(act|do|execut|perform|run|operat)\w*/i, 'action'],
    [/\b(learn|train|adapt|improv|updat)\w*/i, 'learning'],
    [/\b(store|save|remember|record|log)\w*/i, 'storage'],
    [/\b(retriev|recall|fetch|find|search|look)\w*/i, 'retrieval'],
    [/\b(navigat|route|path|direct|locat)\w*/i, 'navigation'],
    [/\b(emotion|feel|mood|sentiment)\w*/i, 'affect'],
    [/\b(goal|intent|want|need|desire|objective)\w*/i, 'goal'],
  ];

  const domains: string[] = [];
  for (const [pat, dom] of domainPatterns) {
    if (pat.test(lower)) domains.push(dom);
  }
  // Take the first (strongest) match if only one expected, otherwise return all
  if (domains.length === 1) grammar.domain = domains[0];
  else if (domains.length > 1) grammar.domain = domains;

  // Entity detection — named things (user:X, agent:X, topic:X, etc.)
  const entityMatches = lower.match(/\b(?:about|regarding|concerning|with|from|by)\s+(\S+)/);
  if (entityMatches) grammar.entity = entityMatches[1];

  // Relation detection
  const relationPatterns: [RegExp, string][] = [
    [/\b(caus|led to|result|because|due to)\w*/i, 'caused-by'],
    [/\b(contain|include|has|with)\w*/i, 'contains'],
    [/\b(depend|require|need)\w*/i, 'depends-on'],
    [/\b(contradict|conflict|oppos)\w*/i, 'contradicts'],
    [/\b(support|confirm|agree|validat)\w*/i, 'supports'],
    [/\b(relat|connect|link|associat)\w*/i, 'associated-with'],
    [/\b(preced|before|prior|earlier)\w*/i, 'precedes'],
    [/\b(follow|after|subsequent|later)\w*/i, 'follows'],
  ];
  for (const [pat, rel] of relationPatterns) {
    if (pat.test(lower)) { grammar.relation = rel; break; }
  }

  // Temporal detection
  const temporalPatterns: [RegExp, string][] = [
    [/\b(now|current|present|immediate|just)\b/i, 'immediate'],
    [/\b(recent|lately|latest|last|just now)\w*/i, 'recent'],
    [/\b(today|this session)\b/i, 'session'],
    [/\b(yesterday|last time|previous)\b/i, 'prior-session'],
    [/\b(old|ancient|long ago|historical)\b/i, 'historical'],
    [/\b(always|permanent|forever|persistent)\b/i, 'permanent'],
  ];
  for (const [pat, temp] of temporalPatterns) {
    if (pat.test(lower)) { grammar.temporal = temp; break; }
  }

  // Qualifier detection — priority/confidence/scope markers
  const qualifierPatterns: [RegExp, string][] = [
    [/\b(urgent|critical|important|high.?pri)\w*/i, 'high-priority'],
    [/\b(uncertain|maybe|possibly|might)\b/i, 'uncertain'],
    [/\b(confirmed|certain|definite|verified)\b/i, 'confirmed'],
    [/\b(private|secret|sensitive|personal)\b/i, 'private'],
    [/\b(shared|public|common|global)\b/i, 'shared'],
  ];
  for (const [pat, qual] of qualifierPatterns) {
    if (pat.test(lower)) { grammar.qualifier = qual; break; }
  }

  return grammar;
}
