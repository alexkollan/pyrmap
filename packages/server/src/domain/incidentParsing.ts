/** Matches the Greek stem for "fire" (πυρκαγιά/πυρκαγιάς/πυρκαγιές/πυρκαγιών/...), case-insensitively (posts often lead with "#Πυρκαγιά"). */
const FIRE_STEM_RE = /πυρκαγ/iu;

// "#ΣανΣήμερα" ("On this day") marks the account's recurring historical/memorial post format
// (e.g. commemorating a firefighter who died in a fire decades ago) — real example, 2026-07-23.
// These mention the πυρκαγ* stem and can even contain a genuine "in [place]" clause (the
// person's birthplace, say), so they don't fall out naturally the way aggregate-stat posts do;
// left unfiltered, one geocoded straight to a real village and would have produced a false
// incident pin for an event 26 years in the past, not a current fire.
const RETROSPECTIVE_RE = /#?Σαν\s*Σήμερα/iu;

/**
 * True if the post is plausibly about a specific *current* fire (mentions the πυρκαγ* stem, and
 * isn't a known non-incident post format). This is deliberately loose beyond that — it's a first
 * gate, not a full classifier. The real filter is that extractLocationPhrase() must also succeed:
 * aggregate-stat posts ("37 fires in 24h") and risk-forecast maps mention fire but have no "in
 * [place]" clause, so they fall out naturally without needing a second, brittle set of exclusion
 * keywords. Verified against a real batch of posts, 2026-07-20 — see docs/DECISIONS.md.
 */
export function isFireIncidentPost(text: string): boolean {
  return FIRE_STEM_RE.test(text) && !RETROSPECTIVE_RE.test(text);
}

export interface ExtractedLocation {
  /** The settlement/place name as written (may be in accusative case, e.g. "Ωρωπό" not "Ωρωπός"). */
  settlement: string;
  /** The region/regional-unit name in genitive case as written (e.g. "Αττικής"), or null for single-place mentions. */
  regionGenitive: string | null;
}

// Greek letters incl. accented forms, used to bound a captured place-name phrase.
const GREEK_WORD = 'Α-Ωα-ωΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰ';
// Short capitalized abbreviations that legitimately open a place name (Ν. = Νέα/"New", Αγ. =
// Άγιος/"Saint", Παλ. = Παλαιά/"Old", ...). Matched explicitly so the phrase body below can
// exclude bare periods entirely — otherwise a non-greedy match happily terminates at an
// abbreviation's own period instead of the real one (real post, 2026-07-20: "...του δήμου Ν.
// Σμύρνης Αττικής." was captured as just "Ν" before this fix — see docs/DECISIONS.md).
const ABBR_PREFIX = '(?:[Α-Ω]{1,3}\\.\\s*)*';
const PHRASE = `${ABBR_PREFIX}[${GREEK_WORD}][${GREEK_WORD}\\s]*?`;

// The phrase ends at a period/comma, OR at the end of the post — some posts (especially short
// ones) have no trailing punctuation at all (real post, 2026-07-20: "...η #πυρκαγιά στο δήμο
// Κιλελέρ Λάρισας" with nothing after "Λάρισας", not even a full stop).
const PHRASE_END = '\\s*(?:[.,]|$)';

// Requires the "στ..." preposition that follows isn't itself the tail of a longer word — without
// this, "στο/στη/στην/στον" also match mid-word (real post, 2026-07-23: "υπέστη" ends in "στη",
// which matched as if it were the preposition "στη", capturing everything up to the next comma —
// "κατά τη διάρκεια κατάσβεσης δασικής πυρκαγιάς" — as a fake settlement/region pair that then
// failed geocoding and got logged as noise for a post that was never about a real place at all).
const PREP_BOUNDARY = `(?<![${GREEK_WORD}])`;

// "του δήμου X Y" (genitive, "of the municipality") or "στο/στον δήμο X Y" (accusative, "in the
// municipality") — the most specific/authoritative phrasing when present, tried first, but only
// when it's not itself preceded by an "assistance from" framing (see below).
const DISTRICT_RE = new RegExp(`${PREP_BOUNDARY}(?:του\\s+δήμου|στ(?:ο|ον)\\s+δήμο)\\s+(${PHRASE})${PHRASE_END}`, 'gu');
// Generic "στο/στη/στην/στον [(την) περιοχή] X Y" fallback. Global so extractLocationPhrase can
// scan every occurrence, not just the first (see its doc comment).
const GENERIC_RE = new RegExp(`${PREP_BOUNDARY}στ(?:ο|η|ην|ον)(?:\\s+(?:την\\s+)?περιοχή)?\\s+(${PHRASE})${PHRASE_END}`, 'gu');

// Leading generic-noun qualifiers ("island X") that aren't part of the place name itself.
const QUALIFIER_RE = /^(?:νήσος|νησί|νησιού)\s+/u;

// "Assistance/backup from [municipality]" framing — that municipality sent help, it isn't where
// the fire is (real example, 2026-07-20: "...Συνδρομή από υδροφόρες του δήμου Λαμιεών." — Lamia
// sent water tankers; the fire was in Paleochori, named earlier in the post). Checked against the
// ~60 chars immediately before a candidate "του δήμου" match.
const ASSISTANCE_CONTEXT_RE = /(?:συνδρομή|βοήθεια|ενίσχυση)[^.]{0,60}$/iu;

function parsePhrase(rawPhrase: string): ExtractedLocation {
  const phrase = rawPhrase.trim().replace(QUALIFIER_RE, '');
  const words = phrase.split(/\s+/);
  if (words.length === 1) {
    return { settlement: words[0]!, regionGenitive: null };
  }
  return {
    settlement: words.slice(0, -1).join(' '),
    regionGenitive: words[words.length - 1]!,
  };
}

/**
 * Extracts the "in [place]" clause the Fire Service's posts consistently include. The last word
 * of the captured phrase is the region in genitive case ("Αττικής", "Κοζάνης"); anything before
 * it is the settlement/municipality name. A single-word capture (e.g. an island name with no
 * region) is returned as the settlement alone. Returns null when no such clause is found — the
 * caller's signal to skip the post (see isFireIncidentPost's doc comment).
 *
 * Deliberately NOT scoped to "the first sentence": an earlier version tried that to stop a later
 * assistance mention from outranking the real location, but Greek abbreviations with periods
 * (Ε.Ι.Χ., Ν. for Νέα, ΕΜΟΔΕ-style acronyms) routinely appear before the real sentence boundary
 * and broke it — a real post ("...σε Ε.Ι.Χ. αυτοκίνητο σε περιοχή του δήμου Ν. Σμύρνης
 * Αττικής...") was skipped entirely because of it. Excluding assistance-framed δήμου mentions by
 * their own wording, rather than by sentence position, fixes both cases without the false cut.
 *
 * The GENERIC_RE fallback scans every match rather than stopping at the first: real miss,
 * 2026-07-23 — "...στην περιοχή Δερβένι, στο Ωραιόκαστρο Θεσσαλονίκης." names a specific
 * micro-locality first (no region, since it's implicitly within what follows) and only the
 * second clause carries the actual disambiguating region. Taking just the first match left
 * "Δερβένι" (a common toponym, 7 national namesakes) with no region to disambiguate it, and it
 * resolved to the wrong one. A later match with a region is strictly more informative than an
 * earlier one without, so it wins; the first match is kept only as a fallback if none has one.
 */
export function extractLocationPhrase(text: string): ExtractedLocation | null {
  for (const match of text.matchAll(DISTRICT_RE)) {
    const before = text.slice(0, match.index);
    if (ASSISTANCE_CONTEXT_RE.test(before)) continue;
    return parsePhrase(match[1]!);
  }

  let fallback: ExtractedLocation | null = null;
  for (const match of text.matchAll(GENERIC_RE)) {
    const candidate = parsePhrase(match[1]!);
    if (candidate.regionGenitive) return candidate;
    fallback ??= candidate;
  }
  return fallback;
}
