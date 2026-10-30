import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventCardWeather } from '@/components/event-card-weather';
import { getHourlyForecastForStart } from '@/lib/open-meteo';

vi.mock('@/lib/open-meteo', () => ({
  getHourlyForecastForStart: vi.fn(),
}));

const mockedForecast = vi.mocked(getHourlyForecastForStart);

describe('EventCardWeather', () => {
  beforeEach(() => {
    mockedForecast.mockReset();
    mockedForecast.mockResolvedValue({
      code: 0,
      temperature: 18.4,
      precipitation: 10,
      windSpeed: 6,
      windDirection: 90,
    });
  });

  it('shows the cancelled status and resolved forecast', async () => {
    render(
      <EventCardWeather
        startsAt="2030-10-25T18:00:00.000Z"
        location="Port Coquitlam"
        status="cancelled"
        index={0}
      />,
    );

    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(await screen.findByText('Clear skies')).toBeInTheDocument();
    expect(screen.getByText('18°C')).toBeInTheDocument();
    expect(screen.getByText(/10% chance of rain/)).toBeInTheDocument();
  });

  it('shows the club placeholder while a forecast is pending', () => {
    mockedForecast.mockReturnValue(new Promise<null>(() => undefined));
    render(
      <EventCardWeather
        startsAt="2030-10-25T18:00:00.000Z"
        location="Port Coquitlam"
        status="published"
        index={1}
      />,
    );

    expect(screen.getByText('Port Coquitlam Tennis Club')).toBeInTheDocument();
  });
});

it('does not render weather for a past event', () => {
  mockedForecast.mockReset();
  const { container } = render(
    <EventCardWeather
      startsAt="2020-10-25T18:00:00.000Z"
      endsAt="2020-10-25T20:00:00.000Z"
      location="Port Coquitlam"
      status="published"
      index={0}
    />,
  );
  expect(container.firstChild).toBeNull();
  expect(mockedForecast).not.toHaveBeenCalled();
});
