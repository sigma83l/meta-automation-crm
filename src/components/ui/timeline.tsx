export type TimelineEntry = {
  id: string;
  time: string;
  timeLabel: string;
  label: string;
};

export function Timeline({ entries }: { entries: readonly TimelineEntry[] }) {
  return (
    <ol className="timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <time dateTime={entry.time}>{entry.timeLabel}</time>
          <span>{entry.label}</span>
        </li>
      ))}
    </ol>
  );
}
