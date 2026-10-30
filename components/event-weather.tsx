'use client';
import { formatTime } from '@/lib/time-format';
import { TennisLoader } from '@/components/tennis-loader';
import { useEffect, useState } from 'react';
import { getHourlyForecastForStart, type HourlyForecast } from '@/lib/open-meteo';
import {
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  Wind,
  Droplets,
  Thermometer,
} from 'lucide-react';
function iconFor(code: number) {
  if (code === 0) return Sun;
  if (code <= 3) return CloudSun;
  if (code <= 48) return CloudFog;
  if (code <= 67 || (code >= 80 && code <= 82)) return CloudRain;
  if (code <= 77 || (code >= 85 && code <= 86)) return CloudSnow;
  return CloudLightning;
}
function labelFor(code: number) {
  if (code === 0) return 'Clear skies';
  if (code <= 3) return code === 1 ? 'Mainly clear' : code === 2 ? 'Partly cloudy' : 'Overcast';
  if (code <= 48) return 'Fog';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}
function compass(degrees: number) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8];
}
export function EventWeather({
  startsAt,
  endsAt,
  location,
  eventLabel = 'event',
}: {
  startsAt: string;
  endsAt?: string;
  location: string;
  eventLabel?: string;
}) {
  const [forecast, setForecast] = useState<HourlyForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hourly, setHourly] = useState<Array<{ at: string; value: HourlyForecast | null }>>([]);
  const [hourlyBusy, setHourlyBusy] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const startTime = new Date(startsAt).getTime();
  const endTime = endsAt ? new Date(endsAt).getTime() : startTime + 2 * 60 * 60 * 1000;
  const hasStarted = clock >= startTime;
  const hasEnded = clock > endTime;
  const forecastTarget = hasStarted ? new Date(clock + 60 * 60 * 1000).toISOString() : startsAt;
  useEffect(() => {
    let active = true;
    setForecast(null);
    if (hasEnded) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    getHourlyForecastForStart(forecastTarget, location)
      .then((result) => {
        if (active) setForecast(result);
      })
      .catch(() => {
        if (active) setForecast(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [forecastTarget, location, hasEnded]);
  if (hasEnded) return null;
  async function showHourlyDetails() {
    setDetailsOpen(true);
    if (hourly.length || hourlyBusy) return;
    setHourlyBusy(true);
    try {
      const start = hasStarted ? new Date(clock + 60 * 60 * 1000) : new Date(startsAt);
      const end = hasStarted
        ? new Date(start.getTime() + 60 * 60 * 1000)
        : new Date(endsAt || startsAt);
      const boundedEnd = end.getTime();
      const instants: Date[] = [];
      for (let cursor = start.getTime(); cursor <= boundedEnd; cursor += 60 * 60 * 1000)
        instants.push(new Date(cursor));
      const rows = await Promise.all(
        instants.map(async (at) => ({
          at: at.toISOString(),
          value: await getHourlyForecastForStart(at.toISOString(), location),
        })),
      );
      setHourly(rows);
    } finally {
      setHourlyBusy(false);
    }
  }

  const Icon = forecast ? iconFor(forecast.code) : CloudSun;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 shadow-sm sm:p-6">
      <div className="pointer-events-none absolute -right-12 -top-14 h-48 w-48 rounded-full bg-sky-100/70 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-800/70">
            On-court conditions
          </p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">Weather forecast</h2>
          <p className="mt-1 text-sm text-slate-600">
            {hasStarted ? 'Forecast for the next hour' : `For the hour the ${eventLabel} starts`}
          </p>
        </div>
        {loading ? (
          <TennisLoader label="Loading forecast" compact />
        ) : (
          forecast && (
            <div className="flex items-center gap-4">
              <Icon className="h-14 w-14 text-sky-700" strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p className="text-2xl font-semibold tracking-tight text-slate-900">
                  {Math.round(forecast.temperature)}°C
                </p>
                <p className="text-sm font-medium text-slate-700">{labelFor(forecast.code)}</p>
              </div>
            </div>
          )
        )}
        {!loading && !forecast && (
          <p className="max-w-sm text-sm text-slate-600">
            A forecast is not available for this time. Hourly forecasts are usually available closer
            to the event.
          </p>
        )}
        <button
          type="button"
          onClick={() => void showHourlyDetails()}
          className="rounded-md border border-sky-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-sky-50"
        >
          Details
        </button>
      </div>
      {detailsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetailsOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tournament-weather-details-title"
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl bg-background p-5 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 id="tournament-weather-details-title" className="text-lg font-semibold">
                Hourly forecast for {eventLabel}
              </h3>
              <button
                type="button"
                onClick={() => setDetailsOpen(false)}
                className="rounded border px-3 py-1 text-sm"
              >
                Close
              </button>
            </div>
            {hourlyBusy ? (
              <div className="py-8">
                <TennisLoader label="Loading hourly forecast" />
              </div>
            ) : hourly.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2">Date and time</th>
                      <th className="p-2">Conditions</th>
                      <th className="p-2">Temp.</th>
                      <th className="p-2">Precip.</th>
                      <th className="p-2">Wind</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hourly.map((row) => (
                      <tr key={row.at} className="border-b border-border">
                        <td className="p-2">
                          {new Date(row.at).toLocaleString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </td>
                        <td className="p-2">
                          {row.value ? labelFor(row.value.code) : 'Forecast unavailable'}
                        </td>
                        <td className="p-2">
                          {row.value ? `${Math.round(row.value.temperature)}°C` : '—'}
                        </td>
                        <td className="p-2">
                          {row.value?.precipitation == null ? '—' : `${row.value.precipitation}%`}
                        </td>
                        <td className="p-2">
                          {row.value?.windSpeed == null
                            ? '—'
                            : `${Math.round(row.value.windSpeed)} km/h`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Hourly forecast is not available for this date. Forecasts are typically available
                only several days in advance.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Forecast availability depends on how far ahead the event is; later hours may not yet
              be available.
            </p>
          </div>
        </div>
      )}
      {forecast && (
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/80 bg-white/75 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Droplets className="h-4 w-4" />
              Chance of precipitation
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {forecast.precipitation == null ? '—' : `${forecast.precipitation}%`}
            </p>
          </div>
          <div className="rounded-xl border border-white/80 bg-white/75 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Wind className="h-4 w-4" />
              Wind
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {forecast.windSpeed == null ? '—' : `${Math.round(forecast.windSpeed)} km/h`}
            </p>
            {forecast.windDirection != null && (
              <p className="text-xs text-slate-500">{compass(forecast.windDirection)} direction</p>
            )}
          </div>
          <div className="col-span-2 rounded-xl border border-white/80 bg-white/75 p-3 sm:col-span-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Thermometer className="h-4 w-4" />
              Forecast time
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {formatTime(forecastTarget)}
            </p>
          </div>
        </div>
      )}
      <p className="relative mt-4 text-xs text-slate-500">
        Forecasts are estimates and may change. Weather data by Open-Meteo.
      </p>
    </section>
  );
}
