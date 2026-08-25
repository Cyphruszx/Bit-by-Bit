export function ProgressBar({ value }: { value: number }) {
  const width = Math.max(0, Math.min(100, value));

  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#edf0ee]">
      <div className="h-full rounded-full bg-[#73a883]" style={{ width: `${width}%` }} />
    </div>
  );
}
