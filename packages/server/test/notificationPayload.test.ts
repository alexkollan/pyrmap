import { describe, expect, it } from 'vitest';
import { buildAlertPayload, buildDetectionPayload, buildIncidentPayload } from '../src/domain/notificationPayload.js';

describe('buildDetectionPayload', () => {
  it('labels a geo-tier detection as unconfirmed and names the nearest place', () => {
    const payload = buildDetectionPayload({ tier: 'geo', latitude: 37.7144, longitude: 24.0565 });
    expect(payload).toEqual({
      title: '🔥 Unconfirmed detection',
      body: 'near Λαύριο — tap to view',
      url: '/?focus=37.7144,24.0565',
    });
  });

  it('labels a polar-tier detection as confirmed', () => {
    const payload = buildDetectionPayload({ tier: 'polar', latitude: 37.7144, longitude: 24.0565 });
    expect(payload.title).toBe('🔥 Confirmed detection');
  });

  it('says "in X" rather than "near X" when only a regional unit resolved', () => {
    const payload = buildDetectionPayload({ tier: 'geo', latitude: 35.9, longitude: 25.9 });
    expect(payload.body).toBe('in Λασίθι — tap to view');
  });
});

describe('buildIncidentPayload', () => {
  it('uses the post text directly as the body, since it already names the place', () => {
    const payload = buildIncidentPayload({
      text: 'Κατεσβέσθη #πυρκαγιά σε οικία στο δήμο Νάουσας. Επιχείρησαν 9 #πυροσβέστες με 3 οχήματα.',
      latitude: 40.6294,
      longitude: 22.0681,
    });
    expect(payload).toEqual({
      title: '📢 Reported fire (X)',
      body: 'Κατεσβέσθη #πυρκαγιά σε οικία στο δήμο Νάουσας. Επιχείρησαν 9 #πυροσβέστες με 3 οχήματα.',
      url: '/?focus=40.6294,22.0681',
    });
  });

  it('truncates a long post to 140 characters', () => {
    const longText = 'Α'.repeat(200);
    const payload = buildIncidentPayload({ text: longText, latitude: 0, longitude: 0 });
    expect(payload.body).toBe(`${'Α'.repeat(140)}…`);
  });
});

describe('buildAlertPayload', () => {
  it('builds a distinctly-titled payload with a focus deep link', () => {
    const payload = buildAlertPayload({ text: 'Πυρκαγιά στην περιοχή #Δερβένι.', latitude: 40.7, longitude: 22.9 });
    expect(payload.title).toBe('🚨 112 Alert');
    expect(payload.url).toBe('/?focus=40.7,22.9');
    expect(payload.body).toContain('Δερβένι');
  });

  it('truncates a long alert body the same way incident payloads do', () => {
    const longText = 'Α'.repeat(200);
    const payload = buildAlertPayload({ text: longText, latitude: 0, longitude: 0 });
    expect(payload.body.endsWith('…')).toBe(true);
    expect(payload.body.length).toBeLessThan(200);
  });
});
