'use client';
import { useEventForecast } from '@/hooks/use-event-forecast';
import { Badge } from '@/components/ui/badge';
import { weatherIconForCode, weatherLabelForCode } from '@/lib/weather-code';
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
  const { forecast, hasStarted, hasEnded } = useEventForecast(startsAt, endsAt, location);
  if (hasEnded) return null;
  const Icon = forecast ? weatherIconForCode(forecast.code) : null;
  const palettes = [
    'from-success/15 via-info/10 to-info/20 text-foreground',
    'from-warning/15 via-warning/10 to-destructive/10 text-foreground',
    'from-muted via-info/10 to-accent/30 text-foreground',
  ];
  return (
    <div
      className={`relative flex h-32 w-full items-center justify-between overflow-hidden bg-gradient-to-br ${palettes[index % palettes.length]} p-5`}
    >
      <div className="pointer-events-none absolute -right-4 -top-10 h-36 w-36 rounded-full bg-card/30 blur-2xl" />
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
            <p className="mt-1 text-lg font-semibold">{weatherLabelForCode(forecast.code)}</p>
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
