export type Person = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  email?: string | null;
  phone?: string | null;
  tennis_skill_level?: number | null;
  birthday_emoji_visible?: boolean;
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
  birthday_emoji_visible?: boolean;
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

export function courtNumbersFor(courtCount: number): number[] {
  return Array.from({ length: Math.max(1, Math.floor(courtCount || 1)) }, (_, index) => index + 1);
}

export function emptyCourtSession(courtCount: number): Session {
  return Object.fromEntries(courtNumbersFor(courtCount).map((court) => [court, []])) as Session;
}

export function copyCourtSession(session: Session, courtCount: number): Session {
  return Object.fromEntries(
    courtNumbersFor(courtCount).map((court) => [court, [...(session[court] ?? [])]]),
  ) as Session;
}

export type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
};
