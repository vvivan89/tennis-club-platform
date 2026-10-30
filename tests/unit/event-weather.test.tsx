import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ forecast: vi.fn() }));
vi.mock('@/lib/open-meteo', () => ({ getHourlyForecastForStart: mocks.forecast }));
import { EventWeather } from '@/components/event-weather';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('EventWeather', () => {
  it('renders temperature, weather description, precipitation, and wind details', async () => {
    mocks.forecast.mockResolvedValue({
      code: 61,
      temperature: 17.4,
      precipitation: 40,
      windSpeed: 12.6,
      windDirection: 90,
    });
    render(<EventWeather startsAt="2030-06-01T18:30:00Z" location="Club courts" />);
    expect(screen.getByText('Loading forecast')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Rain')).toBeInTheDocument());
    expect(screen.getByText('17°C')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('13 km/h')).toBeInTheDocument();
    expect(screen.getByText('E direction')).toBeInTheDocument();
    expect(mocks.forecast).toHaveBeenCalledWith('2030-06-01T18:30:00Z', 'Club courts');
  });

  it('keeps the forecast section visible and explains when no forecast is available', async () => {
    mocks.forecast.mockResolvedValue(null);
    const { container } = render(
      <EventWeather startsAt="2030-06-01T18:30:00Z" location="Nowhere" />,
    );
    await waitFor(() => expect(mocks.forecast).toHaveBeenCalledOnce());
    expect(container.querySelector('section')).toBeInTheDocument();
    expect(screen.getByText(/forecast is not available for this time/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
  });

  it('opens a modal with hourly forecast rows for the event duration', async () => {
    mocks.forecast.mockResolvedValue({
      code: 0,
      temperature: 18,
      precipitation: 0,
      windSpeed: 4,
      windDirection: 180,
    });
    render(
      <EventWeather
        startsAt="2030-06-01T18:00:00Z"
        endsAt="2030-06-01T20:00:00Z"
        location="Club courts"
        eventLabel="tournament"
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(
      await screen.findByRole('dialog', { name: 'Hourly forecast for tournament' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Conditions' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.forecast).toHaveBeenCalledTimes(4));
  });

  it('handles missing measurements without fabricating values', async () => {
    mocks.forecast.mockResolvedValue({
      code: 0,
      temperature: 1.5,
      precipitation: null,
      windSpeed: null,
      windDirection: null,
    });
    render(<EventWeather startsAt="2030-06-01T18:30:00Z" location="Courts" />);
    await waitFor(() => expect(screen.getByText('Clear skies')).toBeInTheDocument());
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/direction/)).not.toBeInTheDocument();
  });
});

describe('EventWeather time-aware display', () => {
  it('hides weather after an event has ended', () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-27T12:00:00Z').getTime());
    const { container } = render(
      <EventWeather
        startsAt="2026-10-27T08:00:00Z"
        endsAt="2026-10-27T10:00:00Z"
        location="Club courts"
      />,
    );
    expect(container.querySelector('section')).not.toBeInTheDocument();
    expect(mocks.forecast).not.toHaveBeenCalled();
  });

  it('requests the next-hour forecast while the event is in progress', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-27T09:15:00Z').getTime());
    mocks.forecast.mockResolvedValue(null);
    render(
      <EventWeather
        startsAt="2026-10-27T08:00:00Z"
        endsAt="2026-10-27T12:00:00Z"
        location="Club courts"
        eventLabel="tournament"
      />,
    );
    await waitFor(() =>
      expect(mocks.forecast).toHaveBeenCalledWith('2026-10-27T10:15:00.000Z', 'Club courts'),
    );
    expect(screen.getByText('Forecast for the next hour')).toBeInTheDocument();
  });
});
