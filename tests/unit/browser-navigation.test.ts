import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateToPath } from '@/lib/browser-navigation';

afterEach(() => vi.unstubAllGlobals());

describe('navigateToPath', () => {
  it('performs a full browser navigation to the supplied path', () => {
    const replace = vi.fn();
    vi.stubGlobal('window', { location: { replace } });

    navigateToPath('/events/summer-open');

    expect(replace).toHaveBeenCalledWith('/events/summer-open');
  });
});
