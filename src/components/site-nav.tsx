'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Activity,
  Calculator,
  Flame,
  Grid3x3,
  LineChart,
  Package,
  Sparkles,
} from 'lucide-react';

import { CardSearch } from '@/components/card-search';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'Overview', icon: Activity },
  { href: '/movers', label: 'Movers', icon: Flame },
  { href: '/heatmap', label: 'Demand', icon: Grid3x3 },
  { href: '/sealed', label: 'Sealed', icon: Package },
  { href: '/fair-value', label: 'Fair Value', icon: Sparkles },
  { href: '/arbitrage', label: 'Grading Arbitrage', icon: Calculator },
  { href: '/market-index', label: 'Market Index', icon: LineChart },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-6 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            MS
          </span>
          <span className="hidden text-sm font-semibold tracking-tight sm:block">
            MintState<span className="text-primary"> Market</span>
          </span>
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto scrollbar-thin">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        <CardSearch />
      </div>
    </header>
  );
}
