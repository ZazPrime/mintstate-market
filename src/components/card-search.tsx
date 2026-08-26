'use client';

import { useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import type { CardSearchResult } from '@/lib/data/market';

export function CardSearch() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (response.ok) setResults((await response.json()).results ?? []);
      } catch {
        // Aborted or offline — keep the previous results.
      }
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={containerRef} className="relative w-40 shrink-0 sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search cards…"
        className="h-9 pl-8 text-sm"
      />
      {open && results.length > 0 && (
        <ul className="absolute right-0 top-11 z-50 max-h-96 w-[22rem] overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl">
          {results.map((card) => (
            <li key={card.id}>
              <Link
                href={`/cards/${card.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary"
              >
                <span className="flex-1 truncate">{card.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {card.set_name} #{card.number}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
