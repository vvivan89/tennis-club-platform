import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GenderSelect } from '@/components/gender-select';

describe('GenderSelect', () => {
  it('requires a selection and exposes the supplied label', () => {
    render(<GenderSelect label="Partner gender" value="" onChange={vi.fn()} />);

    const selector = screen.getByLabelText(/Partner gender/);
    expect(selector).toBeRequired();
    expect(selector).toHaveValue('');
    expect((selector as HTMLSelectElement).checkValidity()).toBe(false);
    expect(screen.getByRole('option', { name: 'Select gender' })).toBeDisabled();
  });

  it('supports controlled values and reports changes', () => {
    const onChange = vi.fn();
    render(<GenderSelect value="male" onChange={onChange} />);

    const selector = screen.getByLabelText(/Gender/);
    expect(selector).toHaveValue('male');
    fireEvent.change(selector, { target: { value: 'female' } });
    expect(onChange).toHaveBeenCalledWith('female');
  });

  it('supports a named uncontrolled field for form submission', () => {
    render(<GenderSelect name="gender" defaultValue="female" />);

    const selector = screen.getByLabelText(/Gender/);
    expect(selector).toHaveAttribute('name', 'gender');
    expect(selector).toHaveValue('female');
    expect(selector).toBeRequired();
  });
});
