import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PriorityBuckets } from '@/components/priority-buckets';

const callbacks = () => ({
  onDropSelectedPanel: vi.fn(),
  onDropSelectedItem: vi.fn(),
  onDropAvailablePanel: vi.fn(),
  onDropAvailableItem: vi.fn(),
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onReorder: vi.fn(),
});

function dropData(source: string) {
  return { dataTransfer: { getData: () => source, setData: vi.fn(), effectAllowed: '' } };
}

describe('PriorityBuckets', () => {
  it('adds, removes and reorders priorities while honoring locked options', () => {
    const handlers = callbacks();
    const { rerender } = render(
      <PriorityBuckets
        options={[
          ['wins', 'Wins'],
          ['games', 'Games'],
        ]}
        priority={[]}
        selectedAriaLabel="Selected ranking priorities"
        emptyPriorityMessage="Choose priorities"
        {...handlers}
      />,
    );
    expect(screen.getByText('Choose priorities')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Wins priority' }));
    expect(handlers.onAdd).toHaveBeenCalledWith('wins');

    rerender(
      <PriorityBuckets
        options={[
          ['wins', 'Wins'],
          ['games', 'Games'],
        ]}
        priority={['wins', 'games']}
        selectedAriaLabel="Selected ranking priorities"
        lockedKeys={['wins']}
        {...handlers}
      />,
    );
    expect(screen.getByText('All options selected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Wins priority' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Wins up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Games down' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Games up' }));
    expect(handlers.onReorder).toHaveBeenCalledWith('games', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Games priority' }));
    expect(handlers.onRemove).toHaveBeenCalledWith('games');
  });

  it('routes panel and item drops to their matching callbacks and stops row bubbling when requested', () => {
    const handlers = callbacks();
    const { container } = render(
      <PriorityBuckets
        options={[
          ['wins', 'Wins'],
          ['games', 'Games'],
          ['sets', 'Sets'],
        ]}
        priority={['wins']}
        selectedAriaLabel="Selected ranking priorities"
        availableAriaLabel="Available ranking priorities"
        stopRowDropPropagation
        {...handlers}
      />,
    );
    const panels = container.querySelectorAll('.rounded-md.border.border-border.p-3');
    fireEvent.drop(panels[0], dropData('games'));
    expect(handlers.onDropSelectedPanel).toHaveBeenCalledWith('games');
    fireEvent.drop(panels[1], dropData('wins'));
    expect(handlers.onDropAvailablePanel).toHaveBeenCalledWith('wins');

    fireEvent.drop(screen.getByText('Wins').closest('li')!, dropData('games'));
    expect(handlers.onDropSelectedItem).toHaveBeenCalledWith('games', 'wins', 0);
    expect(handlers.onDropSelectedPanel).toHaveBeenCalledTimes(1);
    fireEvent.drop(container.querySelector('[data-ranking-key="games"]')!, dropData('sets'));
    expect(handlers.onDropAvailableItem).toHaveBeenCalledWith('sets', 'games');
    expect(handlers.onDropAvailablePanel).toHaveBeenCalledTimes(1);
  });

  it('ignores dropping an item onto itself and uses the ladder data attributes', () => {
    const handlers = callbacks();
    render(
      <PriorityBuckets
        options={[
          ['wins', 'Wins'],
          ['games', 'Games'],
        ]}
        priority={['wins']}
        selectedAriaLabel="Selected ladder priorities"
        dataAttribute="ladder-ranking"
        {...handlers}
      />,
    );
    const selected = document.querySelector('[data-ladder-ranking-key="wins"]')!;
    fireEvent.drop(selected, dropData('wins'));
    expect(handlers.onDropSelectedItem).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ladder-ranking-key="games"]')).toHaveAttribute(
      'data-ladder-ranking-key',
      'games',
    );
  });
});
