import { MarketIndexChart } from '@/components/market-index-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getBenchmarkSeries, getIndexSeries } from '@/lib/data/market';

export const revalidate = 900;

export const metadata = { title: 'Market Index' };

export default async function MarketIndexPage() {
  const [index, benchmark] = await Promise.all([getIndexSeries(), getBenchmarkSeries('SPX')]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MintState 100</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          A chain-linked index of the most liquid graded cards in the market. Each day&apos;s level
          compounds the volume-weighted average daily return of its constituents, so cards entering
          or leaving the basket never create artificial jumps. Both series are rebased to 100 at the
          start of the selected window.
        </p>
      </div>

      <Card className="border-border/70">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">MintState 100 vs. S&amp;P 500</CardTitle>
        </CardHeader>
        <CardContent>
          {index.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No index history yet — run <code className="text-xs">npm run analytics:refresh</code>.
            </p>
          ) : (
            <MarketIndexChart index={index} benchmark={benchmark} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
