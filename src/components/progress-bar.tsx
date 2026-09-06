export function ProgressBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, value));

  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-subtle">
      <div className="h-full rounded-full bg-secondary" style={{ width: `${width}%` }} />
    </div>
  );
}
