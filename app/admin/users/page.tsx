import { notFound } from "next/navigation";

import {
  listUsers,
  maskedEmailsFor,
  searchUsersByEmail
} from "@/src/modules/platform-admin/server/directory";
import {
  createPlatformAdminRuntime,
  PlatformAdminError
} from "@/src/modules/platform-admin/server/runtime";
import { UserDirectory } from "@/src/modules/platform-admin/ui/user-directory";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let runtime;
  try {
    runtime = await createPlatformAdminRuntime("read");
  } catch (error) {
    if (error instanceof PlatformAdminError) notFound();
    throw error;
  }
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : "";
  const users = email
    ? await searchUsersByEmail(runtime, email)
    : await listUsers(runtime, { limit: 100 });
  const maskedEmails = await maskedEmailsFor(
    runtime,
    users.map((user) => user.userId)
  );
  return (
    <UserDirectory
      role={runtime.admin.role}
      users={users}
      maskedEmails={maskedEmails}
      query={email}
    />
  );
}
