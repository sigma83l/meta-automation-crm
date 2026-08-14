import { EmptyState } from "@/src/components/ui/empty-state";

export default function Loading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState title="Loading inbox…" description="Checking service windows and ownership." />
      </section>
    </main>
  );
}
