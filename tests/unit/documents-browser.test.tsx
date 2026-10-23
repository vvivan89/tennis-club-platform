import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentsBrowser } from '@/components/documents-browser';

const docs = [
  {
    id: 'd1',
    title: 'Zebra Minutes',
    description: '',
    created_at: '2025-01-01',
    downloadUrl: null,
  },
  {
    id: 'd2',
    title: 'Annual Bylaws',
    description: 'Current club rules',
    created_at: '2026-01-01',
    downloadUrl: 'https://files.example/bylaws.pdf',
  },
];

describe('DocumentsBrowser', () => {
  it('sorts by newest date by default and identifies unavailable files', () => {
    render(<DocumentsBrowser documents={docs} />);
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveTextContent('Annual Bylaws');
    expect(articles[0].querySelector('a')).toHaveAttribute(
      'href',
      'https://files.example/bylaws.pdf',
    );
    expect(articles[1]).toHaveTextContent('Zebra Minutes');
    expect(articles[1]).toHaveTextContent('Download unavailable');
  });

  it('sorts alphabetically, searches titles case-insensitively, and shows empty states', async () => {
    const user = userEvent.setup();
    render(<DocumentsBrowser documents={docs} />);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'name');
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('Annual Bylaws');
    await user.type(screen.getByLabelText('Search by name'), 'ZEBRA');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Zebra Minutes')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search by name'));
    await user.type(screen.getByLabelText('Search by name'), 'missing');
    expect(screen.getByText('No documents match your search.')).toBeInTheDocument();
    const { unmount } = render(<DocumentsBrowser documents={[]} />);
    expect(screen.getByText('No documents are available yet.')).toBeInTheDocument();
    unmount();
  });
});
