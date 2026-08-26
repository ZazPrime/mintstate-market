import { NextResponse } from 'next/server';

import { searchCards } from '@/lib/data/market';

export const revalidate = 300;

export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get('q') ?? '';
  if (term.trim().length < 2) return NextResponse.json({ results: [] });

  try {
    return NextResponse.json({ results: await searchCards(term) });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message, results: [] }, { status: 500 });
  }
}
