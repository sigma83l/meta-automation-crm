import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export default async function ResetPasswordPage() {
  const { t } = await getRequestPreferences();
  return (
    <AuthShell
      eyebrow={t("auth.recoverySession")}
      title={t("auth.newPasswordTitle")}
      description={t("auth.resetDescription")}
    >
      <AuthForm mode="reset-password" />
    </AuthShell>
  );
}
