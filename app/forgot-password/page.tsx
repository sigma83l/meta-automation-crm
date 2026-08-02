import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export default async function ForgotPasswordPage() {
  const { t } = await getRequestPreferences();
  return (
    <AuthShell
      eyebrow={t("auth.recovery")}
      title={t("auth.resetAccess")}
      description={t("auth.recoveryDescription")}
    >
      <AuthForm
        mode="forgot-password"
        turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
      />
      <p className="auth-link">
        <a href="/login">{t("auth.returnSignIn")}</a>
      </p>
    </AuthShell>
  );
}
