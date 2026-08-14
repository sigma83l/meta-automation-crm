import { EmptyState } from "@/src/components/ui/empty-state";

export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState
          title="Loading automations…"
          description="Checking workspace policy and versions."
        />
      </section>
    </main>
  );
}
