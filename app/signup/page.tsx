import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";
import { getRequestPreferences } from "@/src/lib/i18n/server";

export default async function SignupPage() {
  const { t } = await getRequestPreferences();
  return (
    <AuthShell
      eyebrow={t("auth.newBusiness")}
      title={t("auth.createWorkspace")}
      description={t("auth.signupDescription")}
    >
      <AuthForm mode="signup" turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} />
      <p className="auth-link">
        {t("auth.alreadyRegistered")} <a href="/login">{t("auth.signIn")}</a>
      </p>
    </AuthShell>
  );
}
