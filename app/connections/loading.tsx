import { EmptyState } from "@/src/components/ui/empty-state";

export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState
          title="Loading integrations…"
          description="Checking permissions and webhook health."
        />
      </section>
    </main>
  );
}
