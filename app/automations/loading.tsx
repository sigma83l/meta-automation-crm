export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>Loading automations…</strong>
          <span>Checking workspace policy and versions.</span>
        </div>
      </section>
    </main>
  );
}
