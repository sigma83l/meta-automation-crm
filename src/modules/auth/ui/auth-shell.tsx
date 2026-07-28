import type { ReactNode } from "react";
import Link from "next/link";

export function AuthShell({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-context">
        <Link className="auth-brand" href="/">
          <span className="brand-mark">R</span>
          <span>Relay CRM</span>
        </Link>
        <div>
          <span className="eyebrow">Isolated by design</span>
          <h1>One business. One private workspace.</h1>
          <p>
            Membership establishes authority. A workspace ID submitted by the browser never does.
          </p>
        </div>
        <ol className="auth-proof">
          <li>
            <span>01</span> Server-managed sessions
          </li>
          <li>
            <span>02</span> Database-enforced isolation
          </li>
          <li>
            <span>03</span> Live messaging locked
          </li>
        </ol>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
