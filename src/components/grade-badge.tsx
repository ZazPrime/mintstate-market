import { cn } from '@/lib/utils';
import { gradeTone } from '@/lib/format';

export function GradeBadge({
  grade,
  size = 'sm',
  className,
}: {
  grade: string | null | undefined;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md font-semibold tabular',
        size === 'lg' ? 'h-14 w-14 text-2xl' : 'h-6 min-w-[2.25rem] px-1.5 text-xs',
        gradeTone(grade),
        className,
      )}
      title="Demand durability grade"
    >
      {grade ?? '—'}
    </span>
  );
}
