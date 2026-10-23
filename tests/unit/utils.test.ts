import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('combines conditional classes and resolves conflicting Tailwind utilities', () => {
    expect(cn('px-2 text-sm', false && 'hidden', 'px-4')).toBe('text-sm px-4');
  });

  it('supports object conditions', () => {
    expect(cn({ hidden: false, block: true, 'font-bold': true })).toBe('block font-bold');
  });
});
