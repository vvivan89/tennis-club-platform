import { describe, expect, it } from 'vitest';
import { registrationErrorMessage } from '@/lib/registration-error-message';

describe('registrationErrorMessage', () => {
  it('uses the first useful database field and trims it', () => {
    expect(
      registrationErrorMessage({
        message: 'Could not complete registration.',
        details: '  Event is full.  ',
        hint: 'Try later',
      }),
    ).toBe('Event is full.');
  });

  it('maps gender restrictions and paid membership failures to member-facing explanations', () => {
    expect(registrationErrorMessage('Gender restriction mismatch', 'male')).toBe(
      'This event is restricted to male participants.',
    );
    expect(registrationErrorMessage({ message: 'Requires active paid membership' })).toBe(
      'An active, paid membership is required to register for this event.',
    );
  });

  it('falls back safely for empty, generic, and non-string database errors', () => {
    expect(registrationErrorMessage(null)).toBe(
      'Could not complete registration. Please try again.',
    );
    expect(registrationErrorMessage({ message: 'Could not update registration.' })).toBe(
      'Could not complete registration. Please try again.',
    );
    expect(registrationErrorMessage({ message: 42, hint: false })).toBe(
      'Could not complete registration. Please try again.',
    );
    expect(registrationErrorMessage('   ')).toBe(
      'Could not complete registration. Please try again.',
    );
  });
});
