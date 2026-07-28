export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>Loading inbox…</strong>
          <span>Checking service windows and ownership.</span>
        </div>
      </section>
    </main>
  );
}
