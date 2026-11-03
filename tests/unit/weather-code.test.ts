import { describe, expect, it } from 'vitest';
import { weatherIconForCode, weatherLabelForCode } from '@/lib/weather-code';

describe('Open-Meteo weather code labels and icons', () => {
  it.each([
    [0, 'Clear skies'],
    [1, 'Mainly clear'],
    [2, 'Partly cloudy'],
    [3, 'Overcast'],
    [45, 'Foggy'],
    [48, 'Foggy'],
    [51, 'Rain'],
    [67, 'Rain'],
    [71, 'Snow'],
    [77, 'Snow'],
    [80, 'Rain showers'],
    [82, 'Rain showers'],
    [85, 'Snow showers'],
    [86, 'Snow showers'],
    [95, 'Thunderstorms'],
  ])('maps weather code %i to %s', (code, label) => {
    expect(weatherLabelForCode(code)).toBe(label);
    expect(weatherIconForCode(code)).toBeTruthy();
  });

  it('supports a caller-provided fog label and rain/snow icon groups', () => {
    expect(weatherLabelForCode(45, 'Fog')).toBe('Fog');
    expect(weatherIconForCode(51)).toBe(weatherIconForCode(82));
    expect(weatherIconForCode(71)).toBe(weatherIconForCode(85));
  });
});
