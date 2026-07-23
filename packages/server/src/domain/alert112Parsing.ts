// Greek letters incl. accented forms, plus underscore (hashtags join multi-word place names with
// "_" since X hashtags can't contain spaces, e.g. "#Πάτημα_Κορωπίου").
const GREEK_WORD = 'Α-Ωα-ωΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰ';
const HASHTAG = `#([${GREEK_WORD}_]+)`;
// "Περιφερειακής Ενότητας" (regional unit, genitive) or "Περιφέρειας" (periphery, genitive) — the
// account uses whichever is the natural containing administrative level for the named area (a
// periphery for island groups/Attica-wide alerts, a regional unit otherwise).
const CONTAINER = '(?:Περιφερειακής\\s+Ενότητας|Περιφέρειας)';

const LOCALITY_AND_REGION_RE = new RegExp(`στην\\s+περιοχή\\s+${HASHTAG}\\s+της\\s+${CONTAINER}\\s+${HASHTAG}`, 'u');
const REGION_ONLY_RE = new RegExp(`${CONTAINER}\\s+${HASHTAG}`, 'u');

/**
 * True iff the post is a real 112 activation, written in Greek. @112Greece posts every alert
 * twice — once in Greek, once in English ("Activation" instead of "Ενεργοποίηση") — within the
 * same minute; requiring the literal Greek header word both identifies a genuine activation AND
 * skips the English duplicate for free, with no cross-language timestamp matching needed.
 */
export function isAlert112Post(text: string): boolean {
  return /Ενεργοποίηση/u.test(text);
}

export interface AlertAreas {
  /** The specific local area named (hashtag, underscores expanded to spaces), or null if the post only names a containing region. */
  locality: string | null;
  /** The containing regional unit or periphery name, in genitive case as written (hashtag, underscores expanded to spaces). */
  regionGenitive: string;
}

function unhashtag(raw: string): string {
  return raw.replace(/_/g, ' ');
}

/**
 * Extracts the alert's area from the standard "στην περιοχή #X της {Περιφερειακής
 * Ενότητας|Περιφέρειας} #Y" template. Falls back to a region-only match (no "στην περιοχή"
 * clause at all) when the post names only the containing region — the caller then geocodes to
 * that region's centroid/polygon instead of a specific locality. Returns null when neither
 * pattern is found (the caller's signal to skip the post as unresolvable, same convention as
 * incidentParsing.ts's extractLocationPhrase).
 */
export function extractAlertAreas(text: string): AlertAreas | null {
  const withLocality = LOCALITY_AND_REGION_RE.exec(text);
  if (withLocality) {
    return { locality: unhashtag(withLocality[1]!), regionGenitive: unhashtag(withLocality[2]!) };
  }

  const regionOnly = REGION_ONLY_RE.exec(text);
  if (regionOnly) {
    return { locality: null, regionGenitive: unhashtag(regionOnly[1]!) };
  }

  return null;
}
