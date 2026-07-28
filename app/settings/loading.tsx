export default function SettingsLoading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <div className="empty-guidance">
          <strong>Loading workspace settings…</strong>
          <span>Reading business policy and masked credential status.</span>
        </div>
      </section>
    </main>
  );
}
