export type Person = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  email?: string | null;
  phone?: string | null;
  tennis_skill_level?: number | null;
  suspended?: boolean;
  gender?: string | null;
};

export type Participant = {
  registration_id: string;
  user_id: string;
  status: string;
  queue_position: number | null;
  full_name: string;
  avatar_url: string | null;
  tennis_skill_level: number | null;
  email?: string | null;
  phone?: string | null;
};

export type Assignment = {
  registration_id: string;
  court_number: number;
  segment_order: number;
};

export type RecordLine = { wins: number; losses: number };
export type Warning = { kind: 'overfull' | 'count'; message: string };
export type Session = Record<number, string[]>;

export type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};
