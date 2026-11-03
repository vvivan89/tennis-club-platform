import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentOptionsButton } from '@/components/payment-options-button';

describe('PaymentOptionsButton', () => {
  it('disables an empty menu and runs a sole option directly', async () => {
    const { rerender } = render(<PaymentOptionsButton options={[]} />);
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();

    const pay = vi.fn();
    rerender(<PaymentOptionsButton options={[{ label: 'By Card', onSelect: pay }]} />);
    expect(screen.getByRole('button', { name: 'Pay' })).not.toHaveAttribute('aria-haspopup');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Pay' }));
    expect(pay).toHaveBeenCalledOnce();
  });

  it('shows a menu for multiple methods and ignores unavailable options', async () => {
    const user = userEvent.setup();
    const enabled = vi.fn();
    const disabled = vi.fn();
    const loading = vi.fn();
    render(
      <PaymentOptionsButton
        options={[
          { label: 'By Card', onSelect: enabled },
          { label: 'By Interac', onSelect: disabled, disabled: true },
          { label: 'Processing', onSelect: loading, loading: true },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'By Interac' }));
    expect(disabled).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Starting payment' })).toBeDisabled();
    await user.click(screen.getByRole('menuitem', { name: 'By Card' }));
    expect(enabled).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the options menu on Escape, outside pointer input, and disabled parent action', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const { rerender } = render(
      <>
        <PaymentOptionsButton options={[{ label: 'By Card', onSelect: select }]} />
        <button type="button">Outside</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    rerender(
      <>
        <PaymentOptionsButton
          disabled
          options={[
            { label: 'By Card', onSelect: select },
            { label: 'By Interac', onSelect: vi.fn() },
          ]}
        />
        <button type="button">Outside</button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();
    rerender(
      <>
        <PaymentOptionsButton
          options={[
            { label: 'By Card', onSelect: select },
            { label: 'By Interac', onSelect: vi.fn() },
          ]}
        />
        <button type="button">Outside</button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Pay' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps a menu open for pointer input inside the control and closes it when toggled', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(
      <PaymentOptionsButton
        className="membership-pay"
        options={[
          { label: 'By Card', onSelect: select },
          { label: 'By Interac', onSelect: vi.fn() },
        ]}
      />,
    );
    const pay = screen.getByRole('button', { name: 'Pay' });
    expect(pay).toHaveClass('membership-pay');
    await user.click(pay);
    fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'By Card' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(pay);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not execute a sole option while it is loading and uses its loading label', async () => {
    const select = vi.fn();
    render(
      <PaymentOptionsButton
        options={[
          { label: 'By Card', onSelect: select, loading: true, loadingLabel: 'Opening Stripe' },
        ]}
      />,
    );
    const pay = screen.getByRole('button', { name: 'Opening Stripe' });
    expect(screen.getByRole('status')).toHaveTextContent('Opening Stripe');
    await userEvent.setup().click(pay);
    expect(select).not.toHaveBeenCalled();
  });
});
