import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TennisSkillLevelSelect } from '@/components/tennis-skill-level-select';
import { getTennisSkillLevels } from '@/lib/tennis-skill-levels';

describe('TennisSkillLevelSelect', () => {
  it('defaults to skill levels from 2.5 through 7.0', () => {
    render(<TennisSkillLevelSelect label="Tennis skill rating" />);

    const selector = screen.getByLabelText(/Tennis skill rating/);
    expect(selector).toHaveValue('');
    expect(selector).toBeRequired();
    expect((selector as HTMLSelectElement).checkValidity()).toBe(false);
    expect(
      Array.from((selector as HTMLSelectElement).options).map((option) => option.value),
    ).toEqual(['', ...getTennisSkillLevels()]);
  });

  it('accepts custom minimum and maximum bounds', () => {
    render(<TennisSkillLevelSelect label="Skill" minSkill={1} maxSkill={2} defaultValue="1.5" />);

    const selector = screen.getByLabelText(/Skill/);
    expect(selector).toHaveValue('1.5');
    expect(
      Array.from((selector as HTMLSelectElement).options).map((option) => option.value),
    ).toEqual(['', '1.0', '1.5', '2.0']);
  });

  it('shows the Tennis Canada self-assessment guide in a new tab', () => {
    render(<TennisSkillLevelSelect label="Skill" />);

    const link = screen.getByRole('link', { name: /Self-assesment guide/ });
    expect(link).toHaveAttribute(
      'href',
      'https://assets.tenniscanada.com/production/PDFs/Self-Rating-Guide-English.pdf',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks required fields and reports changes as the selected skill value', () => {
    const onChange = vi.fn();
    render(<TennisSkillLevelSelect label="Tennis skill rating" onChange={onChange} />);

    const selector = screen.getByLabelText(/Tennis skill rating/);
    expect(selector).toBeRequired();
    expect(screen.getByRole('option', { name: 'Select your rating' })).toBeDisabled();

    fireEvent.change(selector, { target: { value: '4.0' } });
    expect(onChange).toHaveBeenCalledWith('4.0');
  });

  it('rejects out-of-range bounds and a maximum below the minimum', () => {
    expect(() => getTennisSkillLevels(-0.5, 3)).toThrow(RangeError);
    expect(() => getTennisSkillLevels(2.5, 7.5)).toThrow(RangeError);
    expect(() => getTennisSkillLevels(4, 3.5)).toThrow(RangeError);
  });
});
