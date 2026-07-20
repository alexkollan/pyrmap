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

  it('strips the leading "νήσος" qualifier so an island name resolves as a single settlement token', () => {
    expect(extractLocationPhrase('Κατεσβέσθη #πυρκαγιά σε ΕΙΧ όχημα, στη νήσος Ρόδος.')).toEqual({
      settlement: 'Ρόδος',
      regionGenitive: null,
    });
  });

  it('returns null for an aggregate-statistics post with no "in [place]" clause', () => {
    expect(extractLocationPhrase('🔥 37 αγροτοδασικές #πυρκαγιές εκδηλώθηκαν το τελευταίο 24ωρο.')).toBeNull();
  });

  it('returns null when there is no location clause at all', () => {
    expect(extractLocationPhrase('⚠️ Χάρτης Πρόβλεψης Κινδύνου 🔥 για αύριο Τρίτη 21/07')).toBeNull();
  });
});
