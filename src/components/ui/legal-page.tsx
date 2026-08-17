import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Shared shell for the public legal documents (privacy, terms, data deletion).
 *
 * These pages must stay reachable without authentication: Meta fetches them
 * during App Review, and `proxy.ts` only gates the prefixes listed in
 * `protectedPrefixes`, which deliberately excludes these routes.
 */
export function LegalPage({
  title,
  lastUpdated,
  children
}: Readonly<{ title: string; lastUpdated: string; children: ReactNode }>) {
  return (
    <main className="legal-page">
      <article className="legal-doc">
        <header className="legal-doc__header">
          <p className="legal-doc__eyebrow">Relay CRM</p>
          <h1>{title}</h1>
          <p className="legal-doc__meta">Last updated {lastUpdated}</p>
        </header>

        <p className="legal-doc__notice" role="note">
          <strong>Draft pending legal review.</strong> This document describes how the service is
          built and currently behaves. It has not been reviewed by a qualified lawyer and is not
          legal advice. Every value shown as <code>[IN BRACKETS]</code> must be replaced with real
          company details before this is relied upon publicly.
        </p>

        {children}

        <footer className="legal-doc__footer">
          <nav aria-label="Legal documents">
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/data-deletion">Data Deletion</Link>
            <Link href="/subprocessors">Subprocessors</Link>
          </nav>
        </footer>
      </article>
    </main>
  );
}
