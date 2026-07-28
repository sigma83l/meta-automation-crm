import { AuthForm } from "@/src/modules/auth/ui/auth-form";
import { AuthShell } from "@/src/modules/auth/ui/auth-shell";

export default function ResetPasswordPage() {
  return (
    <AuthShell
      eyebrow="Recovery session"
      title="Choose a new password"
      description="This form requires the short-lived recovery session established by the email callback."
    >
      <AuthForm mode="reset-password" />
    </AuthShell>
  );
}
