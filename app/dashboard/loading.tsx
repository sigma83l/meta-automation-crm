export default function DashboardLoading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>Loading workspace overview…</strong>
          <span>Checking setup, service windows and attention queues.</span>
        </div>
      </section>
    </main>
  );
}
