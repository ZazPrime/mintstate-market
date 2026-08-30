import { ArbitrageCalculator } from '@/components/arbitrage-calculator';
import { getArbitrageBoard } from '@/lib/data/market';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Grading Arbitrage' };

export default async function ArbitragePage() {
  const rows = await getArbitrageBoard(150);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Grading Arbitrage Calculator</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Compares the all-in cost of buying a raw copy and grading it against current PSA 10
          clearing prices, weighted by each card&apos;s observed gem rate. Adjust the assumptions to
          match your submission tier and marketplace fees.
        </p>
      </div>
      <ArbitrageCalculator rows={rows} />
    </div>
  );
}
