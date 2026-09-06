import type { ReactNode } from "react";

export type SummaryCardTone = "attention" | "healthy" | "draft";

export function SummaryCard({
  tone,
  status,
  title,
  description,
  action
}: {
  tone: SummaryCardTone;
  status: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <article className={`summary-card summary-card--${tone}`}>
      <span className="summary-card__status">{status}</span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action ? <div className="summary-card__action">{action}</div> : null}
    </article>
  );
}
