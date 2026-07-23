import { describe, expect, it } from 'vitest';
import { extractAlertAreas, isAlert112Post } from '../src/domain/alert112Parsing.js';

// Real posts from @112Greece, pasted live by the user 2026-07-23.
const GREEK_DERVENI =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\n‼️ Καπνοί κατευθύνονται στην περιοχή\n\n‼️ Παραμείνετε σε εσωτερικούς χώρου, κλείστε πόρτες & παράθυρα\n\n‼️ Παραμείνετε σε ετοιμότητα και ακολουθείτε τις οδηγίες των Αρχών\n\nℹ️';
const ENGLISH_DERVENI =
  '⚠️Activation 1⃣1⃣2⃣\n\n🆘 Fire in #Derveni area of the regional unit of #Thessaloniki\n\n‼️ The smoke is heading towards your area\n\n‼️ Stay indoors, close doors & windows\n\n‼️ Stay alert and follow the instructions of the Authorities\n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias\n\n@pyrosvestiki';
const GREEK_KALLIGATA =
  '⚠️ Ενεργοποίηση 1️⃣1️⃣2️⃣\n\n🆘 Πυρκαγιά στην περιοχή #Καλλιγάτα της Περιφερειακής Ενότητας #Κεφαλληνίας\n\n‼️ Παραμείνετε σε ετοιμότητα και ακολουθείτε τις οδηγίες των Αρχών \n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias\n\n@pyrosvestiki\n\n\n@hellenicpolice';
const GREEK_PATIMA_KOROPIOU =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Πάτημα_Κορωπίου της Περιφέρειας #Αττικής\n\n‼️ Παραμείνετε σε ετοιμότητα και ακολουθείτε τις οδηγίες των Αρχών\n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias\n\n@pyrosvestiki';

describe('isAlert112Post', () => {
  it('accepts the Greek activation post', () => {
    expect(isAlert112Post(GREEK_DERVENI)).toBe(true);
  });

  it('rejects the English duplicate of the same alert', () => {
    expect(isAlert112Post(ENGLISH_DERVENI)).toBe(false);
  });

  it('rejects unrelated text with no activation header', () => {
    expect(isAlert112Post('Καλημέρα σε όλους')).toBe(false);
  });
});

describe('extractAlertAreas', () => {
  it('extracts locality + regional unit from the standard template', () => {
    expect(extractAlertAreas(GREEK_DERVENI)).toEqual({ locality: 'Δερβένι', regionGenitive: 'Θεσσαλονίκης' });
  });

  it('extracts locality + regional unit with the double-emoji header variant', () => {
    expect(extractAlertAreas(GREEK_KALLIGATA)).toEqual({ locality: 'Καλλιγάτα', regionGenitive: 'Κεφαλληνίας' });
  });

  it('extracts locality + periphery (not regional unit) when the post uses "Περιφέρειας"', () => {
    expect(extractAlertAreas(GREEK_PATIMA_KOROPIOU)).toEqual({ locality: 'Πάτημα Κορωπίου', regionGenitive: 'Αττικής' });
  });

  it('expands an underscore-joined multi-word hashtag to spaces', () => {
    const { locality } = extractAlertAreas(GREEK_PATIMA_KOROPIOU)!;
    expect(locality).not.toContain('_');
  });

  it('falls back to region-only when there is no "στην περιοχή #X" clause', () => {
    const text = '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Έκτακτο δελτίο για την Περιφερειακής Ενότητας #Ηλείας\n\nℹ️';
    expect(extractAlertAreas(text)).toEqual({ locality: null, regionGenitive: 'Ηλείας' });
  });

  it('returns null when neither pattern matches', () => {
    expect(extractAlertAreas('⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Γενική ενημέρωση χωρίς συγκεκριμένη περιοχή.')).toBeNull();
  });
});
