export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>Loading integrations…</strong>
          <span>Checking permissions and webhook health.</span>
        </div>
      </section>
    </main>
  );
}
