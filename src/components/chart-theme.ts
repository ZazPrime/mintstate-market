/** Shared Recharts styling so every chart reads from the same design tokens. */
export const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
} as const;

export const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;

export const GRID_STROKE = 'hsl(var(--border))';
