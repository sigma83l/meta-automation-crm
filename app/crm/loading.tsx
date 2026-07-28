export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>Loading customers…</strong>
          <span>Applying workspace filters.</span>
        </div>
      </section>
    </main>
  );
}
