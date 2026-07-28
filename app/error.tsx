"use client";

export default function ApplicationError({ reset }: { reset: () => void }) {
  return (
    <main className="onboarding-page">
      <section className="panel" role="alert">
        <div className="empty-guidance">
          <strong>The workspace view could not be loaded.</strong>
          <span>No action was sent. Retry after checking the connection.</span>
          <button onClick={reset}>Retry safely</button>
        </div>
      </section>
    </main>
  );
}
