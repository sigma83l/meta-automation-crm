import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export default async function LoginPage() {
  const { t } = await getRequestPreferences();
  return (
    <AuthShell
      eyebrow={t("auth.welcomeBack")}
      title={t("auth.signIn")}
      description={t("auth.loginDescription")}
    >
      <AuthForm mode="login" turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      <div className="auth-link">
        <a href="/forgot-password">{t("auth.forgot")}</a> ·{" "}
        <a href="/signup">{t("auth.createAccount")}</a>
      </div>
    </AuthShell>
  );
}
