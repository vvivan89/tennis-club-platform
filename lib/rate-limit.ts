import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase-service';

type RateLimit = {
  /** Namespaces the counter, e.g. "checkout". */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Counts per user when given; otherwise per client IP. */
  userId?: string | null;
};

function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Returns a 429 response when the caller is over the limit, otherwise null. Fails open if the counter is unavailable. */
export async function enforceRateLimit(
  request: Request,
  { name, limit, windowSeconds, userId }: RateLimit,
): Promise<NextResponse | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const key = `${name}:${userId ? `user:${userId}` : `ip:${clientIp(request)}`}`;
  try {
    const { data, error } = await createServiceRoleClient().rpc('check_rate_limit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error('[Rate limit] Counter unavailable', { name, message: error.message });
      return null;
    }
    if (data !== false) return null;
  } catch (error) {
    console.error('[Rate limit] Counter unavailable', {
      name,
      message: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
  return NextResponse.json(
    { error: 'Too many requests. Please wait a moment and try again.' },
    { status: 429, headers: { 'Retry-After': String(windowSeconds) } },
  );
}
