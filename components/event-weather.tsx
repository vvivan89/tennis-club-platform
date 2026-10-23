'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { useEffect, useState } from 'react';
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
import { getHourlyForecastForStart, type HourlyForecast } from '@/lib/open-meteo';
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
export function EventWeather({ startsAt, location }: { startsAt: string; location: string }) {
  const [forecast, setForecast] = useState<HourlyForecast | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setForecast(null);
    setLoading(true);
    getHourlyForecastForStart(startsAt, location)
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
  }, [startsAt, location]);
  if (!loading && !forecast) return null;
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
          <p className="mt-1 text-sm text-slate-600">For the hour the session starts</p>
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
      </div>
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
              Session time
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">
              {new Date(startsAt).toLocaleTimeString('en-CA', {
                hour: 'numeric',
                minute: '2-digit',
              })}
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
