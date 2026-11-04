import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormFeedback } from '@/components/form-feedback';

describe('FormFeedback', () => {
  it('renders nothing when there is no feedback', () => {
    const { container } = render(<FormFeedback />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces errors and success messages with their respective live roles', () => {
    const { rerender } = render(<FormFeedback error="Unable to save." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to save.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    rerender(<FormFeedback message="Changes saved." className="mt-2" />);
    expect(screen.getByRole('status')).toHaveTextContent('Changes saved.');
    expect(screen.getByRole('status')).toHaveClass('mt-2');

    rerender(<FormFeedback error="Try again." message="Saved previously." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again.');
    expect(screen.getByRole('status')).toHaveTextContent('Saved previously.');
  });
});
