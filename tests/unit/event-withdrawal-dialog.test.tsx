import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventWithdrawalDialog } from '@/components/event-withdrawal-dialog';

describe('EventWithdrawalDialog', () => {
  it('renders only when open and invokes cancel or confirm from the dialog controls', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <EventWithdrawalDialog
        eventId="event-1"
        open={false}
        busy={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    rerender(
      <EventWithdrawalDialog
        eventId="event-1"
        open
        busy={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Withdraw from this event?');
    fireEvent.click(dialog);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep my place' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not cancel while busy and stops parent click handling when requested', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(
      <div onClick={onConfirm}>
        <EventWithdrawalDialog
          eventId="event-2"
          open
          busy
          stopPropagation
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </div>,
    );
    const backdrop = container.querySelector('.fixed.inset-0') as HTMLDivElement;
    const backdropClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    backdrop.dispatchEvent(backdropClick);
    expect(backdropClick.defaultPrevented).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Withdrawing/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep my place' })).toBeDisabled();
  });
});
