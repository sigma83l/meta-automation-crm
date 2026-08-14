import { EmptyState } from "@/src/components/ui/empty-state";

export default function SettingsLoading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState
          title="Loading workspace settings…"
          description="Reading business policy and masked credential status."
        />
      </section>
    </main>
  );
}
