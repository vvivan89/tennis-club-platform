'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';

const extensions = [
  StarterKit,
  Underline,
  Link.configure({ openOnClick: false, protocols: ['http', 'https', 'mailto'] }),
];

export function TournamentRulesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions,
    content: value || '<p></p>',
    immediatelyRender: false,
    onUpdate: ({ editor }: { editor: { getHTML: () => string } }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class:
          'min-h-36 p-3 text-sm focus:outline-none prose prose-sm max-w-none dark:prose-invert',
      },
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || '<p></p>', false);
  }, [editor, value]);

  if (!editor)
    return (
      <div className="min-h-36 rounded-md border border-input p-3 text-sm text-muted-foreground">
        Loading rules editor…
      </div>
    );
  const controls = [
    ['Bold', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
    ['Italic', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
    [
      'Underline',
      () => editor.chain().focus().toggleUnderline().run(),
      editor.isActive('underline'),
    ],
    [
      'Heading',
      () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      editor.isActive('heading', { level: 3 }),
    ],
    [
      'Bullets',
      () => editor.chain().focus().toggleBulletList().run(),
      editor.isActive('bulletList'),
    ],
    [
      'Numbers',
      () => editor.chain().focus().toggleOrderedList().run(),
      editor.isActive('orderedList'),
    ],
  ] as const;
  return (
    <div className="rounded-md border border-input">
      <div
        className="flex flex-wrap gap-1 border-b border-border bg-secondary/30 p-2"
        aria-label="Rules formatting"
      >
        {controls.map(([label, action, active]) => (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={action}
            className={`rounded border px-2 py-1 text-xs ${active ? 'border-primary bg-primary/10' : 'border-border'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-36 max-h-[32rem] resize-y overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
