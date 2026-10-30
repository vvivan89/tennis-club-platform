'use client';
import { useEffect, useState } from 'react';
import { CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import { getHourlyForecastForStart, type HourlyForecast } from '@/lib/open-meteo';
import { Badge } from '@/components/ui/badge';

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
  if (code <= 48) return 'Foggy';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}
export function EventCardWeather({
  startsAt,
  location,
  status,
  index,
  endsAt,
}: {
  startsAt: string;
  location: string;
  status: string;
  index: number;
  endsAt?: string | null;
}) {
  const [forecast, setForecast] = useState<HourlyForecast | null>(null);
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
    if (hasEnded)
      return () => {
        active = false;
      };
    getHourlyForecastForStart(forecastTarget, location)
      .then((result) => {
        if (active) setForecast(result);
      })
      .catch(() => {
        if (active) setForecast(null);
      });
    return () => {
      active = false;
    };
  }, [forecastTarget, location, hasEnded]);
  if (hasEnded) return null;
  const Icon = forecast ? iconFor(forecast.code) : null;
  const palettes = [
    'from-emerald-100 via-teal-50 to-sky-100 text-emerald-950',
    'from-amber-100 via-orange-50 to-rose-100 text-amber-950',
    'from-slate-200 via-sky-100 to-indigo-100 text-slate-900',
  ];
  return (
    <div
      className={`relative flex h-32 w-full items-center justify-between overflow-hidden bg-gradient-to-br ${palettes[index % palettes.length]} p-5`}
    >
      <div className="pointer-events-none absolute -right-4 -top-10 h-36 w-36 rounded-full bg-white/30 blur-2xl" />
      <div className="relative z-10 min-w-0">
        {status === 'cancelled' && (
          <Badge variant="destructive" className="mb-2">
            Cancelled
          </Badge>
        )}
        {forecast ? (
          <>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
              {hasStarted ? 'Current forecast' : 'Event forecast'}
            </p>
            <p className="mt-1 text-lg font-semibold">{labelFor(forecast.code)}</p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className="font-semibold">{Math.round(forecast.temperature)}°C</span>
              {forecast.precipitation != null && (
                <span className="opacity-75">· {forecast.precipitation}% chance of rain</span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
            Port Coquitlam Tennis Club
          </p>
        )}
      </div>
      {Icon && (
        <div className="relative z-10 flex shrink-0 flex-col items-center gap-1 pl-3">
          <Icon className="h-14 w-14 drop-shadow-sm" strokeWidth={1.5} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
