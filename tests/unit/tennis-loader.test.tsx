import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TennisLoader } from '@/components/tennis-loader';

describe('TennisLoader', () => {
  it('announces the default loading status accessibly', () => {
    render(<TennisLoader />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('renders a custom label and compact class', () => {
    render(<TennisLoader label="Uploading" compact />);
    expect(screen.getByRole('status')).toHaveTextContent('Uploading');
    expect(screen.getByRole('status')).toHaveClass('tennis-loader-compact');
  });
});
