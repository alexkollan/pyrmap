import { describe, expect, it } from 'vitest';
import { extractLocationPhrase, isFireIncidentPost } from '../src/domain/incidentParsing.js';

// All strings below are real posts pulled live from @pyrosvestiki, 2026-07-20 — see docs/DECISIONS.md.
describe('isFireIncidentPost', () => {
  it('matches the fire hashtag whether or not it leads the post (case-insensitive)', () => {
    expect(isFireIncidentPost('Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Πέραμα Αττικής.')).toBe(true);
    expect(isFireIncidentPost('#Πυρκαγιά σε χαμηλή βλάστηση, στο Πέραμα Αττικής.')).toBe(true);
  });

  it('rejects posts with no fire stem at all (rescues, accidents, heat-safety notices)', () => {
    expect(
      isFireIncidentPost(
        'Ολοκληρώθηκε η επιχείρηση μεταφοράς τραυματισμένης γυναίκας από δύσβατο σε ασφαλές σημείο και παραδόθηκε σε ασθενοφόρο του ΕΚΑΒ, στην περιοχή Γριά Βάθρα Σαμοθράκης.',
      ),
    ).toBe(false);
    expect(isFireIncidentPost('🌞 Προστατευόμαστε και προστατεύουμε κατά τη διάρκεια του καύσωνα ‼️')).toBe(false);
  });

  it('the daily risk-forecast map has no fire stem and is rejected by this gate alone', () => {
    expect(isFireIncidentPost('⚠️ Χάρτης Πρόβλεψης Κινδύνου 🔥 για αύριο Τρίτη 21/07')).toBe(false);
  });
});

describe('extractLocationPhrase', () => {
  it('extracts settlement + region-genitive from the standard "στο X Y." template', () => {
    expect(extractLocationPhrase('Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κυριάκι Βοιωτίας.')).toEqual({
      settlement: 'Κυριάκι',
      regionGenitive: 'Βοιωτίας',
    });
  });

  it('handles the "στην περιοχή X Y" variant', () => {
    expect(extractLocationPhrase('Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στην περιοχή Μηλάκι Ευβοίας.')).toEqual({
      settlement: 'Μηλάκι',
      regionGenitive: 'Ευβοίας',
    });
  });

  it('prefers the "του δήμου X Y" clause over an earlier, unrelated "στον/στο" phrase in the same sentence', () => {
    const text =
      'Σορός εντοπίστηκε κατά τη διάρκεια κατάσβεσης πυρκαγιάς, στον παράδρομο της Εγνατίας οδού, στην θέση Μαυροχώματα, του δήμου Ωραιοκάστρου Θεσσαλονίκης.';
    expect(extractLocationPhrase(text)).toEqual({ settlement: 'Ωραιοκάστρου', regionGenitive: 'Θεσσαλονίκης' });
  });

  it('ignores a "του δήμου X" clause in a LATER sentence — that names which municipality sent backup resources, not the fire location', () => {
    // Real post, 2026-07-20: fire is in Paleochori (first sentence); Lamia's water tankers helped (second sentence).
    const text =
      '#Πυρκαγιά σε χαμηλή βλάστηση στην περιοχή Παλαιοχώρι Φθιώτιδας. Κινητοποιήθηκαν 30 #πυροσβέστες με 1 ομάδα πεζοπόρου της 4ης ΕΜΟΔΕ, 8 οχήματα, 5 Α/Φ και 1 Ε/Π. Συνδρομή από υδροφόρες του δήμου Λαμιεών.';
    expect(extractLocationPhrase(text)).toEqual({ settlement: 'Παλαιοχώρι', regionGenitive: 'Φθιώτιδας' });
  });

  it('does not let an abbreviation period (Ε.Ι.Χ., Ν.) truncate the location phrase', () => {
    // Real post, 2026-07-20: an earlier attempt to fix the Paleochori bug above by scoping to
    // "the first sentence" broke this one — the first period in the whole text is inside "Ε.Ι.Χ.",
    // long before the real location. The place name itself also starts with an abbreviation
    // ("Ν." = Νέα/"New"), which must survive as part of the settlement, not be cut off at its dot.
    const text = 'Κατεσβέσθη #πυρκαγιά σε Ε.Ι.Χ. αυτοκίνητο σε περιοχή του δήμου Ν. Σμύρνης Αττικής. Επιχείρησαν 6 #πυροσβέστες με 2 οχήματα.';
    expect(extractLocationPhrase(text)).toEqual({ settlement: 'Ν. Σμύρνης', regionGenitive: 'Αττικής' });
  });

  it('matches "στο δήμο X Y" (accusative), not just "του δήμου X Y" (genitive), with no trailing punctuation at all', () => {
    // Real post, 2026-07-20 — short post, no period at the end, and uses "στο δήμο" (accusative,
    // "in the municipality") rather than the genitive form the other tests cover.
    const text = 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο δήμο Κιλελέρ Λάρισας';
    expect(extractLocationPhrase(text)).toEqual({ settlement: 'Κιλελέρ', regionGenitive: 'Λάρισας' });
  });

  it('strips the leading "νήσος" qualifier so an island name resolves as a single settlement token', () => {
    expect(extractLocationPhrase('Κατεσβέσθη #πυρκαγιά σε ΕΙΧ όχημα, στη νήσος Ρόδος.')).toEqual({
      settlement: 'Ρόδος',
      regionGenitive: null,
    });
  });

  it('skips an assistance-framed "του δήμου X" clause that comes BEFORE the real fire location, not just after', () => {
    // The existing assistance-exclusion test only covers the framing appearing in a later
    // sentence; the exclusion check itself is purely local (looks at the ~60 chars before the
    // match), so it should work regardless of which sentence comes first. Confirms that directly.
    const text =
      'Συνδρομή από υδροφόρες του δήμου Λαμιεών. Η πυρκαγιά εντοπίστηκε στην περιοχή του δήμου Παλαιοχωρίου Φθιώτιδας.';
    expect(extractLocationPhrase(text)).toEqual({ settlement: 'Παλαιοχωρίου', regionGenitive: 'Φθιώτιδας' });
  });

  it('matches an all-caps fire stem, not just the usual mixed-case hashtag styling', () => {
    expect(isFireIncidentPost('ΠΥΡΚΑΓΙΑ σε δασική έκταση στο δήμο Κορωπίου.')).toBe(true);
    expect(extractLocationPhrase('ΠΥΡΚΑΓΙΑ σε δασική έκταση στο δήμο Κορωπίου.')).toEqual({
      settlement: 'Κορωπίου',
      regionGenitive: null,
    });
  });

  it('only ever extracts ONE location from a post naming two separate, unrelated fires', () => {
    // Known limitation, not a bug fix in this commit: extractLocationPhrase returns a single
    // location, so if the account ever bundles multiple distinct incidents into one post, only
    // the first is kept and the second is silently dropped. No live example has confirmed this
    // actually happens yet — flagged here so a future miss is recognized immediately as "the
    // known limitation", not re-investigated as a new mystery. See docs/DECISIONS.md 2026-07-22.
    const text = 'Κατεσβέσθη #πυρκαγιά στο δήμο Νάουσας. #Πυρκαγιά σε εξέλιξη στο δήμο Αχαρνών.';
    expect(extractLocationPhrase(text)).toEqual({ settlement: 'Νάουσας', regionGenitive: null });
  });

  it('returns null for an aggregate-statistics post with no "in [place]" clause', () => {
    expect(extractLocationPhrase('🔥 37 αγροτοδασικές #πυρκαγιές εκδηλώθηκαν το τελευταίο 24ωρο.')).toBeNull();
  });

  it('returns null when there is no location clause at all', () => {
    expect(extractLocationPhrase('⚠️ Χάρτης Πρόβλεψης Κινδύνου 🔥 για αύριο Τρίτη 21/07')).toBeNull();
  });
});
