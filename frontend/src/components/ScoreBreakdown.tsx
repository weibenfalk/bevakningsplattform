// Types
import type { ScoreBreakdown as Breakdown } from '@/api';

const round = (n: number) => Math.round(n * 10) / 10;

/** Hur poängen räknades fram, så som den sparades i pipelinen (inget räknas om här). */
export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown | null }) {
  if (!breakdown) return <p className="text-sm text-muted-foreground">Ingen uppdelning sparad för den här artikeln.</p>;

  return (
    <div className="flex flex-col gap-2 text-sm">
      <table className="w-full">
        <thead className="text-left text-xs text-muted-foreground">
          <tr><th>Del</th><th className="text-right">Värde</th><th className="text-right">Vikt</th><th className="text-right">Poäng</th></tr>
        </thead>
        <tbody>
          {breakdown.components.map((c) => (
            <tr key={c.key}>
              <td>{c.label}</td>
              <td className="text-right">{round(c.input)}</td>
              <td className="text-right">× {c.weight}</td>
              <td className="text-right">{round(c.points)}</td>
            </tr>
          ))}
          <tr className="border-t font-medium"><td colSpan={3}>Summa</td><td className="text-right">{round(breakdown.base)}</td></tr>
        </tbody>
      </table>
      {breakdown.factors.length === 0 ? (
        <p className="text-muted-foreground">Inga påslag eller avdrag.</p>
      ) : (
        <ul>
          {breakdown.factors.map((f) => (
            <li key={f.key} className={f.multiplier > 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
              {f.label}: × {f.multiplier} ({f.multiplier > 1 ? 'påslag' : 'avdrag'})
            </li>
          ))}
        </ul>
      )}
      <p className="font-medium">Poäng: {breakdown.score}</p>
    </div>
  );
}
