export function ProgressBar({
  value,
  tone = "default",
}: {
  value: number;
  tone?: "default" | "over";
}) {
  const width = Math.max(0, Math.min(100, value));

  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-subtle">
      <div
        className={`h-full rounded-full ${tone === "over" ? "bg-primary-strong" : "bg-primary"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
