import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type ChatRow = {
  id: string;
  user_id: string;
  body: string;
  image_path: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  mentions: string[];
};

const mocks = vi.hoisted(() => ({
  messages: [] as ChatRow[],
  names: [
    { id: 'member-1', full_name: 'Alex Member' },
    { id: 'member-2', full_name: 'Taylor Member' },
  ],
  avatars: [] as Array<{ id: string; avatar_url: string | null }>,
  unread: 2 as number | null,
  loadError: null as null | { message: string },
  writeErrors: {} as Record<string, { message: string } | null>,
  inserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  deletes: [] as string[],
  upserts: [] as Array<Record<string, unknown>>,
  ranges: [] as Array<[number, number]>,
  uploads: [] as Array<{ path: string; file: File }>,
  removedFiles: [] as string[][],
  createSignedUrl: vi.fn(),
  removeChannel: vi.fn(),
  channelHandlers: [] as Array<(...args: unknown[]) => void>,
}));

function queryFor(table: string) {
  let operation = 'select';
  let start = 0;
  let end = 100;
  let values: Record<string, unknown> = {};
  let id = '';
  const query = {
    select: () => query,
    eq: (column: string, value: string) => {
      if (column === 'id') id = value;
      return query;
    },
    order: () => query,
    limit: () => query,
    range: (from: number, to: number) => {
      start = from;
      end = to;
      mocks.ranges.push([from, to]);
      return query;
    },
    maybeSingle: async () => ({ data: mocks.messages[0] ?? null, error: null }),
    single: async () => ({
      data: { id: 'new-message' },
      error: mocks.writeErrors[`${table}.insert`] ?? null,
    }),
    insert: (payload: Record<string, unknown>) => {
      operation = 'insert';
      values = payload;
      mocks.inserts.push(payload);
      return query;
    },
    update: (payload: Record<string, unknown>) => {
      operation = 'update';
      values = payload;
      mocks.updates.push(payload);
      return query;
    },
    delete: () => {
      operation = 'delete';
      return query;
    },
    upsert: (payload: Record<string, unknown>) => {
      operation = 'upsert';
      values = payload;
      mocks.upserts.push(payload);
      return query;
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      if (table === 'member_chat_messages' && operation === 'delete') mocks.deletes.push(id);
      const error =
        table === 'member_chat_messages' && operation === 'select'
          ? mocks.loadError
          : (mocks.writeErrors[`${table}.${operation}`] ?? null);
      const data =
        table === 'member_chat_messages' && operation === 'select'
          ? mocks.messages.slice(start, end + 1)
          : null;
      return Promise.resolve({ data, error, values }).then(resolve, reject);
    },
  };
  return query;
}

const channel = {
  on: (...args: unknown[]) => {
    const handler = args.at(-1);
    if (typeof handler === 'function')
      mocks.channelHandlers.push(handler as (...args: unknown[]) => void);
    return channel;
  },
  subscribe: () => channel,
};

const supabase = {
  from: (table: string) => queryFor(table),
  rpc: vi.fn(async (name: string) => {
    if (name === 'get_member_chat_member_names') return { data: mocks.names, error: null };
    if (name === 'get_member_chat_member_avatars') return { data: mocks.avatars, error: null };
    if (name === 'get_member_chat_unread_count') return { data: mocks.unread, error: null };
    return { data: null, error: null };
  }),
  storage: {
    from: () => ({
      createSignedUrl: mocks.createSignedUrl,
      upload: async (path: string, file: File) => {
        mocks.uploads.push({ path, file });
        return { error: mocks.writeErrors['storage.upload'] ?? null };
      },
      remove: async (paths: string[]) => {
        mocks.removedFiles.push(paths);
        return { error: null };
      },
    }),
  },
  channel: () => channel,
  removeChannel: mocks.removeChannel,
};

vi.mock('@/lib/supabase-browser', () => ({ createSupabaseBrowserClient: () => supabase }));

import { MemberChat } from '@/components/member-chat';

function chatRow(overrides: Partial<ChatRow> = {}): ChatRow {
  return {
    id: 'message-1',
    user_id: 'member-2',
    body: 'Hello club',
    image_path: null,
    created_at: new Date(Date.now() - 60_000).toISOString(),
    updated_at: null,
    deleted_at: null,
    mentions: [],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.messages = [];
  mocks.names = [
    { id: 'member-1', full_name: 'Alex Member' },
    { id: 'member-2', full_name: 'Taylor Member' },
  ];
  mocks.avatars = [];
  mocks.unread = 2;
  mocks.loadError = null;
  mocks.writeErrors = {};
  mocks.inserts = [];
  mocks.updates = [];
  mocks.deletes = [];
  mocks.upserts = [];
  mocks.ranges = [];
  mocks.uploads = [];
  mocks.removedFiles = [];
  mocks.channelHandlers = [];
  mocks.createSignedUrl.mockReset().mockResolvedValue({
    data: { signedUrl: 'https://images.example/signed' },
    error: null,
  });
  mocks.removeChannel.mockReset();
  supabase.rpc.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ failed: 0 }) }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MemberChat', () => {
  it('loads messages, signed images, names, unread count, and online presence', async () => {
    mocks.messages = [chatRow({ image_path: 'member-2/photo.png', mentions: ['member-1'] })];
    mocks.avatars = [{ id: 'member-2', avatar_url: 'https://images.example/avatar.png' }];
    render(<MemberChat userId="member-1" />);
    expect(await screen.findByText('Hello club')).toBeInTheDocument();
    expect(screen.getByText('Taylor Member')).toBeInTheDocument();
    expect(screen.getByAltText('Image attached to chat message')).toHaveAttribute(
      'src',
      'https://images.example/signed',
    );
    expect(screen.getByText('0 online · 2 unread')).toBeInTheDocument();
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('member-2/photo.png', 3600);

    window.dispatchEvent(
      new CustomEvent('pctc-chat-presence-updated', { detail: { userIds: ['member-2'] } }),
    );
    expect(await screen.findByLabelText('Members currently online')).toHaveTextContent(
      'Taylor Member',
    );
    expect(screen.getByText('1 online · 2 unread')).toBeInTheDocument();
    expect(mocks.upserts).toContainEqual(
      expect.objectContaining({ user_id: 'member-1', last_read_message_id: 'message-1' }),
    );
  });

  it('shows empty and load-error states and paginates older messages', async () => {
    const user = userEvent.setup();
    mocks.loadError = { message: 'unavailable' };
    const view = render(<MemberChat userId="member-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load chat history');

    view.unmount();
    mocks.loadError = null;
    mocks.messages = Array.from({ length: 101 }, (_, index) =>
      chatRow({ id: `message-${index}`, body: `Club message ${index}` }),
    );
    render(<MemberChat userId="member-1" />);
    expect(await screen.findByRole('button', { name: 'Load older messages' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load older messages' }));
    await waitFor(() => expect(mocks.ranges).toContainEqual([100, 200]));
    expect(screen.getByText('Club message 100')).toBeInTheDocument();
  });

  it('selects a mention, sends the message, and marks it read', async () => {
    const user = userEvent.setup();
    render(<MemberChat userId="member-1" />);
    const messageBox = await screen.findByRole('textbox', { name: 'Message' });
    await user.type(messageBox, '@Taylor');
    await user.click(await screen.findByRole('button', { name: 'Taylor Member' }));
    await user.type(messageBox, 'welcome!');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.inserts[0]).toMatchObject({
      user_id: 'member-1',
      body: '@Taylor Member welcome!',
      mentions: ['member-2'],
      image_path: null,
    });
    expect(fetch).toHaveBeenCalledWith('/api/member/chat/cleanup-images', { method: 'POST' });
    expect(mocks.upserts.at(-1)).toMatchObject({ user_id: 'member-1' });
  });

  it('labels own edited messages and avoids duplicate mentions while appending emoji', async () => {
    const user = userEvent.setup();
    mocks.messages = [
      chatRow({ user_id: 'member-1', updated_at: new Date().toISOString(), body: 'Earlier' }),
    ];
    render(<MemberChat userId="member-1" />);

    expect(await screen.findByText('You')).toBeInTheDocument();
    expect(screen.getByText('(edited)')).toBeInTheDocument();
    const messageBox = screen.getByRole('textbox', { name: 'Message' });
    await user.type(messageBox, '@Taylor');
    await user.click(await screen.findByRole('button', { name: 'Taylor Member' }));
    await user.type(messageBox, '@Taylor');
    await user.click(await screen.findByRole('button', { name: 'Taylor Member' }));
    await user.click(screen.getByRole('button', { name: 'Insert smiley' }));
    await user.click(screen.getByRole('button', { name: 'Insert 🎾' }));
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.inserts[0]).toMatchObject({
      body: '@Taylor Member @Taylor Member 🎾',
      mentions: ['member-2'],
    });
  });

  it('handles a missing author profile, empty mention matches, and keyboard submission', async () => {
    const user = userEvent.setup();
    mocks.names = [];
    mocks.unread = null;
    mocks.messages = [
      chatRow({ user_id: 'deleted-member', mentions: null as unknown as string[] }),
    ];
    render(<MemberChat userId="member-1" />);

    expect(await screen.findByText('Hello club')).toBeInTheDocument();
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByText('0 online · 0 unread')).toBeInTheDocument();
    const messageBox = screen.getByRole('textbox', { name: 'Message' });
    await user.type(messageBox, '@Nobody');
    expect(screen.getByText('No members found')).toBeInTheDocument();
    await user.clear(messageBox);
    await user.type(messageBox, 'Sent with Enter');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(mocks.inserts).toContainEqual(
        expect.objectContaining({ body: 'Sent with Enter', mentions: [] }),
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/member/chat/push',
      expect.objectContaining({
        body: JSON.stringify({ messageId: 'new-message' }),
        keepalive: true,
      }),
    );
  });

  it('sends an image-only message and uses a safe extension for names ending in a dot', async () => {
    const user = userEvent.setup();
    render(<MemberChat userId="member-1" />);
    await screen.findByText('No messages found. Start the conversation.');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['image'], 'court.', { type: 'image/png' })] },
    });
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.uploads[0].path).toMatch(/\.jpg$/);
    expect(mocks.inserts[0]).toMatchObject({ body: '', image_path: mocks.uploads[0].path });
  });

  it('validates image type and size, uploads valid images, and removes failed uploads', async () => {
    const user = userEvent.setup();
    mocks.writeErrors['member_chat_messages.insert'] = { message: 'insert denied' };
    render(<MemberChat userId="member-1" />);
    await screen.findByText('No messages found. Start the conversation.');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'bad.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a JPEG, PNG, GIF, or WebP image',
    );

    const large = new File([new Uint8Array(1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [large] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Images must be 1 MB or smaller.');

    mocks.writeErrors['member_chat_messages.insert'] = { message: 'insert denied' };
    fireEvent.change(fileInput, {
      target: { files: [new File(['image'], 'court.PNG', { type: 'image/png' })] },
    });
    expect(screen.getByText('Image selected: court.PNG')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to send message. Please try again.',
    );
    expect(mocks.uploads[0].path).toMatch(/^member-1\/.+\.png$/);
    expect(mocks.removedFiles[0]).toEqual([mocks.uploads[0].path]);
  });

  it('edits recent messages, reports stale edits, and confirms message deletion', async () => {
    const user = userEvent.setup();
    mocks.messages = [chatRow({ id: 'own-message', user_id: 'member-1', body: 'Original' })];
    const view = render(<MemberChat userId="member-1" />);
    await screen.findByText('Original');
    await user.click(screen.getByRole('button', { name: /Message actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.clear(screen.getByRole('textbox', { name: 'Edit message' }));
    await user.type(screen.getByRole('textbox', { name: 'Edit message' }), 'Edited');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updates).toContainEqual({ body: 'Edited' }));

    mocks.writeErrors['member_chat_messages.update'] = { message: 'Expired five minutes ago' };
    view.rerender(<MemberChat userId="member-1" />);
    await user.click(screen.getByRole('button', { name: /Message actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Messages can only be edited within five minutes.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    mocks.writeErrors['member_chat_messages.update'] = null;
    await user.click(screen.getByRole('button', { name: /Message actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete message?');
    await user.click(screen.getByRole('button', { name: 'Delete message' }));
    await waitFor(() => expect(mocks.deletes).toContain('own-message'));
  });

  it('does not delete when canceled and reports delete-window errors', async () => {
    const user = userEvent.setup();
    mocks.messages = [chatRow({ id: 'own-message', user_id: 'member-1' })];
    render(<MemberChat userId="member-1" />);
    await screen.findByText('Hello club');
    await user.click(screen.getByRole('button', { name: /Message actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.deletes).toHaveLength(0);

    mocks.writeErrors['member_chat_messages.delete'] = { message: 'five minutes elapsed' };
    await user.click(screen.getByRole('button', { name: /Message actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Messages can only be deleted within five minutes.',
    );
  });
});
