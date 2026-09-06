import type { ReactNode } from "react";

const ICON: Record<StatusBannerVariant, string> = {
  success: "✓",
  info: "i",
  warning: "!",
  danger: "!"
};

export type StatusBannerVariant = "success" | "info" | "warning" | "danger";

export function StatusBanner({
  variant,
  title,
  description,
  action
}: {
  variant: StatusBannerVariant;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={`status-banner status-banner--${variant}`}
      role={variant === "warning" || variant === "danger" ? "alert" : "status"}
    >
      <span className="status-banner__icon" aria-hidden="true">
        {ICON[variant]}
      </span>
      <div className="status-banner__body">
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="status-banner__action">{action}</div> : null}
    </div>
  );
}
