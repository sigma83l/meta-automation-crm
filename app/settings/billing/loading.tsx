import { EmptyState } from "@/src/components/ui/empty-state";

export default function BillingSettingsLoading() {
  return (
    <main className="content" aria-busy="true">
      <section className="panel">
        <EmptyState
          title="Loading billing…"
          description="Reading subscription and payment method status."
        />
      </section>
    </main>
  );
}
