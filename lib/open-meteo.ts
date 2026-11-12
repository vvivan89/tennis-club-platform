export type HourlyForecast = {
  code: number;
  temperature: number;
  precipitation: number | null;
  windSpeed: number | null;
  windDirection: number | null;
};

type JsonValue = string | number | boolean | null | JsonValue[] | JsonRecord;
type JsonRecord = { [key: string]: JsonValue };
const responseCache = new Map<string, Promise<JsonRecord>>();

async function getJson(url: string): Promise<JsonRecord> {
  if (!responseCache.has(url)) {
    responseCache.set(
      url,
      fetch(url)
        .then((response) => {
          if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status})`);
          return response.json();
        })
        .catch((error) => {
          responseCache.delete(url);
          throw error;
        }),
    );
  }
  return responseCache.get(url)!;
}

function localHourKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:00`;
}

/** Returns the forecast for the local clock-hour in which the session starts. */
export async function getHourlyForecastForStart(
  startsAt: string,
  location: string,
): Promise<HourlyForecast | null> {
  const target = new Date(startsAt);
  if (!Number.isFinite(target.getTime())) return null;
  const now = Date.now();
  // Open-Meteo's 16-day range is inclusive of today, so keep a small safety
  // margin rather than requesting an hour that the API cannot return.
  if (target.getTime() < now - 60 * 60 * 1000 || target.getTime() - now > 15 * 24 * 60 * 60 * 1000)
    return null;

  async function geocode(query: string) {
    if (!query.trim()) return null;
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=en&format=json`;
      const result = await getJson(url);
      const places: JsonRecord[] = Array.isArray(result.results)
        ? result.results.filter(
            (place): place is JsonRecord =>
              typeof place === 'object' && place !== null && !Array.isArray(place),
          )
        : [];
      // Prefer a British Columbia / Canadian match when the place name is broad.
      return (
        places.find(
          (p) =>
            /British Columbia/i.test(typeof p.admin1 === 'string' ? p.admin1 : '') &&
            /Canada/i.test(typeof p.country === 'string' ? p.country : ''),
        ) ??
        places.find((p) => /Canada/i.test(typeof p.country === 'string' ? p.country : '')) ??
        places[0] ??
        null
      );
    } catch {
      return null;
    }
  }

  let place = await geocode(location);
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') {
    place = await geocode('Port Coquitlam, British Columbia, Canada');
  }
  // The club is based in Port Coquitlam; this coordinate fallback keeps forecasts
  // available if Open-Meteo's geocoder is temporarily unavailable.
  const latitude = typeof place?.latitude === 'number' ? place.latitude : 49.2625;
  const longitude = typeof place?.longitude === 'number' ? place.longitude : -122.7811;
  const zoneParam =
    typeof place?.timezone === 'string' && place.timezone ? place.timezone : 'America/Vancouver';
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m&timezone=${encodeURIComponent(zoneParam)}&forecast_days=16`;
  let forecast: JsonRecord;
  try {
    forecast = await getJson(forecastUrl);
  } catch {
    return null;
  }
  const hourlyValue = forecast.hourly;
  const hourly =
    typeof hourlyValue === 'object' && hourlyValue !== null && !Array.isArray(hourlyValue)
      ? (hourlyValue as JsonRecord)
      : null;
  const times: string[] = Array.isArray(hourly?.time)
    ? hourly.time.filter((value): value is string => typeof value === 'string')
    : [];
  const timeZone =
    typeof forecast.timezone === 'string' && forecast.timezone ? forecast.timezone : zoneParam;
  if (!times.length) return null;

  // API times are local wall-clock strings. Convert the event instant into the
  // forecast location's zone, then use that exact local start hour.
  const requestedHour = localHourKey(target, timeZone);
  let index = times.indexOf(requestedHour);
  // Some API responses can omit timezone metadata or return a differently
  // formatted timestamp. Compare normalized hour keys as a defensive fallback.
  if (index < 0)
    index = times.findIndex(
      (value) => value.replace(' ', 'T').slice(0, 13) === requestedHour.slice(0, 13),
    );
  if (index < 0) return null;

  const weatherCodes = Array.isArray(hourly?.weather_code)
    ? hourly.weather_code
    : Array.isArray(hourly?.weathercode)
      ? hourly.weathercode
      : [];
  const temperatures = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  const code = weatherCodes[index];
  const temperature = temperatures[index];
  if (typeof code !== 'number' || typeof temperature !== 'number') return null;
  const precipitationValues = Array.isArray(hourly?.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const windSpeeds = Array.isArray(hourly?.wind_speed_10m) ? hourly.wind_speed_10m : [];
  const windDirections = Array.isArray(hourly?.wind_direction_10m) ? hourly.wind_direction_10m : [];
  const precipitationValue = precipitationValues[index];
  const windSpeed = windSpeeds[index];
  const windDirection = windDirections[index];
  return {
    code,
    temperature,
    precipitation: typeof precipitationValue === 'number' ? precipitationValue : null,
    windSpeed: typeof windSpeed === 'number' ? windSpeed : null,
    windDirection: typeof windDirection === 'number' ? windDirection : null,
  };
}
