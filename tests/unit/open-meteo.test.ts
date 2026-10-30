import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHourlyForecastForStart } from '@/lib/open-meteo';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getHourlyForecastForStart', () => {
  it('returns null for an invalid date without making a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getHourlyForecastForStart('not-a-date', 'Port Coquitlam')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for sessions outside the forecast window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getHourlyForecastForStart('2026-11-15T12:00:00.000Z', 'Port Coquitlam'),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses fallback coordinates and legacy weather fields when geocoding is unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('geocoding-api.open-meteo.com'))
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      return new Response(
        JSON.stringify({
          timezone: 'UTC',
          hourly: {
            time: ['2026-10-25T18:00'],
            weathercode: [61],
            temperature_2m: [11],
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getHourlyForecastForStart('2026-10-25T18:30:00.000Z', '')).resolves.toEqual({
      code: 61,
      temperature: 11,
      precipitation: null,
      windSpeed: null,
      windDirection: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('latitude=49.2625&longitude=-122.7811');
  });

  it('returns null when the forecast request fails or has no matching hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('geocoding-api.open-meteo.com'))
        return new Response(JSON.stringify({ results: [{ latitude: 49, longitude: -123 }] }), {
          status: 200,
        });
      return new Response(JSON.stringify({ hourly: { time: [] } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      getHourlyForecastForStart('2026-10-25T18:00:00.000Z', 'Langley no-hour'),
    ).resolves.toBeNull();

    const failingFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('geocoding-api.open-meteo.com'))
        return new Response(
          JSON.stringify({
            results: [{ latitude: 37.123, longitude: -121.987, timezone: 'UTC', country: 'US' }],
          }),
          { status: 200 },
        );
      return new Response('unavailable', { status: 503 });
    });
    vi.stubGlobal('fetch', failingFetch);
    await expect(
      getHourlyForecastForStart('2026-10-25T18:00:00.000Z', 'No geocoder result'),
    ).resolves.toBeNull();
  });

  it('selects the forecast for the event local start hour', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T12:00:00.000Z'));
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('geocoding-api.open-meteo.com')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                latitude: 49.26,
                longitude: -122.78,
                timezone: 'America/Vancouver',
                country: 'Canada',
                admin1: 'British Columbia',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          timezone: 'America/Vancouver',
          hourly: {
            time: ['2026-10-22T06:00', '2026-10-22T07:00'],
            weather_code: [3, 61],
            temperature_2m: [13.5, 12],
            precipitation_probability: [20, 80],
            wind_speed_10m: [8, 12],
            wind_direction_10m: [180, 220],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getHourlyForecastForStart('2026-10-22T13:30:00.000Z', 'Port Coquitlam'),
    ).resolves.toEqual({
      code: 3,
      temperature: 13.5,
      precipitation: 20,
      windSpeed: 8,
      windDirection: 180,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
