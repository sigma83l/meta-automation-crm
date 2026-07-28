import Link from "next/link";

export default function NotFound() {
  return (
    <main className="onboarding-page">
      <section className="panel">
        <div className="empty-guidance">
          <strong>This workspace item is unavailable.</strong>
          <span>It may not exist, or your membership does not grant access.</span>
          <Link href="/dashboard">Return to overview</Link>
        </div>
      </section>
    </main>
  );
}
