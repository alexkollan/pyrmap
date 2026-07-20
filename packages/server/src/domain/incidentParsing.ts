/** Matches the Greek stem for "fire" (πυρκαγιά/πυρκαγιάς/πυρκαγιές/πυρκαγιών/...), case-insensitively (posts often lead with "#Πυρκαγιά"). */
const FIRE_STEM_RE = /πυρκαγ/iu;

/**
 * True if the post is plausibly about a specific fire (mentions the πυρκαγ* stem). This is
 * deliberately loose — it's a first gate, not a full classifier. The real filter is that
 * extractLocationPhrase() must also succeed: aggregate-stat posts ("37 fires in 24h") and
 * risk-forecast maps mention fire but have no "in [place]" clause, so they fall out naturally
 * without needing a second, brittle set of exclusion keywords. Verified against a real batch
 * of posts, 2026-07-20 — see docs/DECISIONS.md.
 */
export function isFireIncidentPost(text: string): boolean {
  return FIRE_STEM_RE.test(text);
}

export interface ExtractedLocation {
  /** The settlement/place name as written (may be in accusative case, e.g. "Ωρωπό" not "Ωρωπός"). */
  settlement: string;
  /** The region/regional-unit name in genitive case as written (e.g. "Αττικής"), or null for single-place mentions. */
  regionGenitive: string | null;
}

// Greek letters incl. accented forms, used to bound a captured place-name phrase.
const GREEK_WORD = 'Α-Ωα-ωΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰ';
const PHRASE = `[${GREEK_WORD}][${GREEK_WORD}.\\s]*?`;

// "του δήμου X Y" is the most specific/authoritative phrasing when present — tried first so a
// sentence that also mentions an incidental road/location earlier doesn't win instead.
const DISTRICT_RE = new RegExp(`του\\s+δήμου\\s+(${PHRASE})\\s*[.,]`, 'u');
// Generic "στο/στη/στην/στον [(την) περιοχή] X Y" fallback.
const GENERIC_RE = new RegExp(`στ(?:ο|η|ην|ον)(?:\\s+(?:την\\s+)?περιοχή)?\\s+(${PHRASE})\\s*[.,]`, 'u');

// Leading generic-noun qualifiers ("island X") that aren't part of the place name itself.
const QUALIFIER_RE = /^(?:νήσος|νησί|νησιού)\s+/u;

/**
 * Extracts the "in [place]" clause the Fire Service's posts consistently include. The last word
 * of the captured phrase is the region in genitive case ("Αττικής", "Κοζάνης"); anything before
 * it is the settlement/municipality name. A single-word capture (e.g. an island name with no
 * region) is returned as the settlement alone. Returns null when no such clause is found —
 * the caller's signal to skip the post (see isFireIncidentPost's doc comment).
 *
 * Search is scoped to the FIRST sentence only. The fire's actual location is always there; a
 * "του δήμου X" appearing in a later sentence is often just which municipality sent backup water
 * tankers, not where the fire is (real example, 2026-07-20 — see docs/DECISIONS.md: "...στην
 * περιοχή Παλαιοχώρι Φθιώτιδας. ... Συνδρομή από υδροφόρες του δήμου Λαμιεών." — Λαμιεών/Lamia
 * sent help; the fire was in Paleochori). A period inside an abbreviation before the real
 * sentence end (rare, not seen in practice) would defeat this — accepted tradeoff.
 */
export function extractLocationPhrase(text: string): ExtractedLocation | null {
  const firstPeriod = text.indexOf('.');
  const firstSentence = firstPeriod === -1 ? text : text.slice(0, firstPeriod + 1);

  const match = DISTRICT_RE.exec(firstSentence) ?? GENERIC_RE.exec(firstSentence);
  if (!match) return null;

  const phrase = match[1]!.trim().replace(QUALIFIER_RE, '');
  const words = phrase.split(/\s+/);
  if (words.length === 1) {
    return { settlement: words[0]!, regionGenitive: null };
  }

  return {
    settlement: words.slice(0, -1).join(' '),
    regionGenitive: words[words.length - 1]!,
  };
}
