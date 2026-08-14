import { EmptyState } from "@/src/components/ui/empty-state";

export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState
          title="Loading analytics…"
          description="Aggregating workspace metrics and definitions."
        />
      </section>
    </main>
  );
}
