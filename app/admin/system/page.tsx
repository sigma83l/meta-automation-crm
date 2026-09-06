import { notFound } from "next/navigation";

import {
  listDeadLetters,
  listStuckOutboxEvents,
  loadOutboxHealth
} from "@/src/modules/platform-admin/server/ops";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { listSwitches } from "@/src/modules/platform-admin/server/switches";
import { SystemPanel } from "@/src/modules/platform-admin/ui/system-panel";

export const dynamic = "force-dynamic";

export default async function AdminSystemPage() {
  let runtime;
  try {
    // "operations" rather than "read": this page is the switches, and a support
    // role that cannot move them has no reason to be looking at them either.
    runtime = await createPlatformAdminRuntime("operations");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }

  const [switches, deadLetters, outbox, stuckOutbox] = await Promise.all([
    listSwitches(runtime),
    listDeadLetters(runtime, { limit: 50 }),
    loadOutboxHealth(runtime),
    listStuckOutboxEvents(runtime, { limit: 50 })
  ]);

  return (
    <SystemPanel
      role={runtime.admin.role}
      switches={switches}
      deadLetters={deadLetters}
      outbox={outbox}
      stuckOutbox={stuckOutbox}
    />
  );
}
