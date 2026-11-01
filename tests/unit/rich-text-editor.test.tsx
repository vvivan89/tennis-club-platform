import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  editor: null as null | Record<string, any>,
  options: null as null | Record<string, any>,
  run: vi.fn(),
  setContent: vi.fn(),
  setLink: vi.fn(),
}));
vi.mock('@tiptap/react', () => ({
  useEditor: (options: Record<string, any>) => {
    mocks.options = options;
    return mocks.editor;
  },
  EditorContent: () => <div data-testid="editor-content" contentEditable />,
}));

import { RichTextEditor } from '@/components/rich-text-editor';

function createEditor() {
  const chain = {
    focus: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleUnderline: () => chain,
    toggleHeading: () => chain,
    toggleBulletList: () => chain,
    toggleOrderedList: () => chain,
    undo: () => chain,
    redo: () => chain,
    setLink: (attributes: unknown) => {
      mocks.setLink(attributes);
      return chain;
    },
    run: mocks.run,
  };
  return {
    chain: () => chain,
    isActive: () => false,
    getHTML: () => '<p>updated</p>',
    commands: { setContent: mocks.setContent },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.options = null;
  mocks.editor = null;
});

describe('RichTextEditor', () => {
  it('shows a loader before the editor is initialized', () => {
    mocks.editor = null;
    render(<RichTextEditor value="<p>Draft</p>" onChange={vi.fn()} />);
    expect(screen.getByText('Loading editor')).toBeInTheDocument();
  });

  it('exposes formatting tools, emits changed HTML, syncs changed props, and applies prompted links', async () => {
    mocks.editor = createEditor();
    const onChange = vi.fn();
    const user = userEvent.setup();
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com');
    const { rerender } = render(<RichTextEditor value="<p>Original</p>" onChange={onChange} />);
    expect(screen.getByTestId('editor-content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(mocks.run).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(prompt).toHaveBeenCalledWith('Enter link URL');
    expect(mocks.setLink).toHaveBeenCalledWith({ href: 'https://example.com' });

    mocks.options?.onUpdate({ editor: mocks.editor });
    expect(onChange).toHaveBeenCalledWith('<p>updated</p>');
    rerender(<RichTextEditor value="" onChange={onChange} />);
    expect(mocks.setContent).toHaveBeenCalledWith('<p></p>', { emitUpdate: false });
    prompt.mockRestore();
  });
});
