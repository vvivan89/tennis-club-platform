'use client';

import { useEffect, useState } from 'react';
import { getHourlyForecastForStart, type HourlyForecast } from '@/lib/open-meteo';

export function useEventForecast(
  startsAt: string,
  endsAt: string | null | undefined,
  location: string,
) {
  const [forecast, setForecast] = useState<HourlyForecast | null>(null);
  const [loading, setLoading] = useState(false);
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

  return { forecast, loading, clock, hasStarted, hasEnded, forecastTarget };
}
