'use client';
import { TennisLoader } from '@/components/tennis-loader';
import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';

export function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [StarterKit, Underline, Link.configure({ openOnClick: false, autolink: true })],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { class: 'min-h-40 w-full p-3 text-sm leading-6 focus:outline-none' },
    },
  });
  useEffect(() => {
    if (editor && editor.getHTML() !== value) editor.commands.setContent(value || '<p></p>', false);
  }, [value, editor]);
  if (!editor)
    return (
      <div className="min-h-40 rounded-md border border-input p-3">
        <TennisLoader label="Loading editor" />
      </div>
    );
  const tools: [string, () => void, boolean?][] = [
    ['Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
    ['Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
    [
      'Underline',
      () => editor.chain().focus().toggleUnderline().run(),
      editor.isActive('underline'),
    ],
    [
      'Heading',
      () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      editor.isActive('heading'),
    ],
    [
      'Bullets',
      () => editor.chain().focus().toggleBulletList().run(),
      editor.isActive('bulletList'),
    ],
    [
      'Numbered list',
      () => editor.chain().focus().toggleOrderedList().run(),
      editor.isActive('orderedList'),
    ],
    ['Undo', () => editor.chain().focus().undo().run()],
    ['Redo', () => editor.chain().focus().redo().run()],
  ];
  return (
    <div className="overflow-hidden rounded-md border border-input">
      <div className="flex flex-wrap gap-1 border-b border-border bg-muted/40 p-2">
        {tools.map(([label, run, active]) => (
          <button
            type="button"
            key={label}
            onClick={run}
            aria-pressed={!!active}
            className={`rounded px-2 py-1 text-xs hover:bg-accent ${active ? 'bg-accent font-semibold' : ''}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="rounded px-2 py-1 text-xs hover:bg-accent"
          onClick={() => {
            const url = window.prompt('Enter link URL');
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
        >
          Link
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
