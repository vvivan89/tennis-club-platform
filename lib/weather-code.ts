import { CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';

export function weatherIconForCode(code: number) {
  if (code === 0) return Sun;
  if (code <= 3) return CloudSun;
  if (code <= 48) return CloudFog;
  if (code <= 67 || (code >= 80 && code <= 82)) return CloudRain;
  if (code <= 77 || (code >= 85 && code <= 86)) return CloudSnow;
  return CloudLightning;
}

export function weatherLabelForCode(code: number, fogLabel = 'Foggy') {
  if (code === 0) return 'Clear skies';
  if (code <= 3) return code === 1 ? 'Mainly clear' : code === 2 ? 'Partly cloudy' : 'Overcast';
  if (code <= 48) return fogLabel;
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}
