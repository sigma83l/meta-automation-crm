import { EmptyState } from "@/src/components/ui/empty-state";

export default function DashboardLoading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState
          title="Loading workspace overview…"
          description="Checking setup, service windows and attention queues."
        />
      </section>
    </main>
  );
}
