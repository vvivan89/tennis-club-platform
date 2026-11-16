import { describe, expect, it } from 'vitest';
import {
  emptyLegalGuardian,
  isUnder18,
  normalizeLegalGuardians,
  playerAge,
  validateLegalGuardians,
} from '@/lib/player-guardian-details';

describe('player guardian details', () => {
  it('uses the eighteenth birthday as the age boundary', () => {
    expect(isUnder18('2008-11-16', '2026-11-15')).toBe(true);
    expect(isUnder18('2008-11-15', '2026-11-15')).toBe(false);
    expect(playerAge('2012-05-14', '2026-11-15')).toBe(14);
    expect(playerAge('2008-11-16', '2026-11-15')).toBe(17);
  });

  it('requires a named guardian with at least one contact for an underage player', () => {
    expect(() => validateLegalGuardians('2012-05-14', [])).toThrow(
      /at least one parent or legal guardian/i,
    );
    expect(() =>
      validateLegalGuardians('2012-05-14', [{ name: 'Parent', email: '', phone: '' }]),
    ).toThrow(/name and at least one contact method/i);
    expect(() =>
      validateLegalGuardians('2012-05-14', [
        { name: 'Parent', email: 'parent@example.test', phone: '' },
      ]),
    ).not.toThrow();
  });

  it('normalizes multiple underage contacts and omits guardian details for adults', () => {
    const guardians = [
      { name: 'Parent One', email: ' PARENT@EXAMPLE.TEST ', phone: '' },
      { name: 'Parent Two', email: '', phone: '6045550101' },
    ];
    expect(normalizeLegalGuardians(guardians, '2012-05-14')).toEqual([
      { name: 'Parent One', email: 'parent@example.test', phone: '' },
      { name: 'Parent Two', email: '', phone: '6045550101' },
    ]);
    expect(normalizeLegalGuardians(guardians, '1990-05-14')).toEqual([]);
    expect(emptyLegalGuardian()).toEqual({ name: '', email: '', phone: '' });
  });
});
