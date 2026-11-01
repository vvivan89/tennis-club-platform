import { NextResponse } from 'next/server';
import { checkAdminRole, getSignedInUser } from '@/lib/api-helpers';
export async function POST(req: Request) {
  try {
    const { auth: s, user, response: authError } = await getSignedInUser();
    if (authError) return authError;
    const adminError = await checkAdminRole(s, user.id);
    if (adminError) return adminError;
    const b = await req.json();
    const start = new Date(`${b.season_start_date}T12:00:00Z`),
      end = new Date(`${b.season_end_date}T12:00:00Z`);
    const priceKeys = ['single_price_cad', 'family_price_cad'];
    if (
      priceKeys.some(
        (k) => typeof b[k] !== 'number' || !Number.isFinite(b[k]) || b[k] < 0 || b[k] > 100000,
      ) ||
      !Number.isInteger(b.family_max_adults) ||
      b.family_max_adults < 1 ||
      b.family_max_adults > 10 ||
      !Number.isInteger(b.family_max_children) ||
      b.family_max_children < 0 ||
      b.family_max_children > 20 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.season_start_date) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.season_end_date) ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      start.getUTCDate() !== Number(b.season_start_date.slice(8, 10)) ||
      end.getUTCDate() !== Number(b.season_end_date.slice(8, 10)) ||
      start >= end
    )
      return NextResponse.json(
        { error: 'Enter valid prices, family limits, and a season end date after the start date.' },
        { status: 400 },
      );
    const { error } = await s.from('membership_plan_settings').upsert({
      id: 1,
      single_price_cents: Math.round(b.single_price_cad * 100),
      family_price_cents: Math.round(b.family_price_cad * 100),
      family_max_adults: b.family_max_adults,
      family_max_children: b.family_max_children,
      season_start_month: start.getUTCMonth() + 1,
      season_start_day: start.getUTCDate(),
      season_end_month: end.getUTCMonth() + 1,
      season_end_day: end.getUTCDate(),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error('Saving membership settings failed:', error);
      return NextResponse.json(
        { error: `Could not save membership settings: ${error.message}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected error.' },
      { status: 500 },
    );
  }
}
