import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ forecast: vi.fn() }));
vi.mock('@/lib/open-meteo', () => ({ getHourlyForecastForStart: mocks.forecast }));
import { EventWeather } from '@/components/event-weather';

afterEach(() => {
  cleanup();
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

  it('hides the forecast section when no forecast is available', async () => {
    mocks.forecast.mockResolvedValue(null);
    const { container } = render(
      <EventWeather startsAt="2030-06-01T18:30:00Z" location="Nowhere" />,
    );
    await waitFor(() => expect(mocks.forecast).toHaveBeenCalledOnce());
    expect(container.querySelector('section')).not.toBeInTheDocument();
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
