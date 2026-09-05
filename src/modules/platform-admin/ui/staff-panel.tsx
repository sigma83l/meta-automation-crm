"use client";

import { useI18n } from "@/src/lib/i18n/client";

import type { PlatformAdminRole } from "../contracts";
import { AdminShell } from "./admin-shell";
import { ReasonAction } from "./reason-action";

export type StaffMember = Readonly<{
  userId: string;
  role: PlatformAdminRole;
  status: "active" | "disabled";
  displayName: string | null;
  maskedEmail: string;
  grantedReason: string;
  createdAt: string;
}>;

/**
 * Who holds staff access, and the only screen that can change it.
 *
 * Reachable by `platform_owner` alone. The whole reason the roles are ranked is
 * that a support hire who can read every workspace should not be one form
 * submission away from being able to suspend customers — and a self-service
 * promotion screen would hand them exactly that.
 */
export function StaffPanel({
  role,
  staff,
  currentUserId
}: {
  role: PlatformAdminRole;
  staff: readonly StaffMember[];
  currentUserId: string;
}) {
  const { text } = useI18n();

  const roleLabel = (value: PlatformAdminRole) =>
    value === "platform_owner"
      ? text("Owner — can grant access", "Sahip — erişim verebilir", "مالک — می‌تواند دسترسی دهد")
      : value === "platform_admin"
        ? text(
            "Admin — can act on customers",
            "Yönetici — müşterilere işlem yapabilir",
            "مدیر — می‌تواند روی مشتریان اقدام کند"
          )
        : text(
            "Support — read and view",
            "Destek — okuma ve görüntüleme",
            "پشتیبانی — خواندن و مشاهده"
          );

  return (
    <AdminShell active="staff" role={role}>
      <div className="content">
        <section className="panel crm-table-panel">
          <div className="panel-heading">
            <h2>{text("Staff access", "Personel erişimi", "دسترسی کارکنان")}</h2>
          </div>
          <div className="warning-box">
            {text(
              "Everyone listed here can read every customer's data. Grant the lowest role that does the job.",
              "Burada listelenen herkes her müşterinin verisini okuyabilir. İşi görecek en düşük rolü verin.",
              "همه افراد این فهرست می‌توانند داده هر مشتری را بخوانند. کمترین نقشی را بدهید که کار را انجام دهد."
            )}
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{text("Person", "Kişi", "شخص")}</th>
                <th>{text("Role", "Rol", "نقش")}</th>
                <th>{text("Granted for", "Veriliş gerekçesi", "دلیل اعطا")}</th>
                <th>{text("Actions", "İşlemler", "اقدامات")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <strong>
                      {member.displayName ?? text("Unnamed", "İsimsiz", "بدون نام")}
                      {member.userId === currentUserId ? ` · ${text("you", "siz", "شما")}` : ""}
                    </strong>
                    <small dir="ltr">{member.maskedEmail}</small>
                  </td>
                  <td>
                    <span
                      className={
                        member.status === "active"
                          ? "status-pill"
                          : "status-pill status-pill-warning"
                      }
                    >
                      {roleLabel(member.role)}
                    </span>
                  </td>
                  <td>{member.grantedReason}</td>
                  <td className="admin-actions-cell">
                    {/*
                      A revoked row gets one control, and it says what it does.
                      This used to be the same "Change role" trigger as an active
                      row, and posting it restored the person's access as a side
                      effect of the upsert — a quiet reinstatement of the right
                      to read every customer, worded as an edit. Now it is its
                      own action, with the two deliberate presses the other
                      consequential controls have.
                    */}
                    {member.status === "active" ? (
                      <>
                        <ReasonAction
                          endpoint="staff"
                          body={{ action: "grant", userId: member.userId }}
                          label={text("Change role", "Rolü değiştir", "تغییر نقش")}
                          fields={[
                            {
                              key: "role",
                              kind: "select",
                              label: text("Role", "Rol", "نقش"),
                              defaultValue: member.role,
                              options: [
                                { value: "platform_support", label: "platform_support" },
                                { value: "platform_admin", label: "platform_admin" },
                                { value: "platform_owner", label: "platform_owner" }
                              ]
                            }
                          ]}
                        />
                        <ReasonAction
                          endpoint="staff"
                          body={{ action: "revoke", userId: member.userId }}
                          label={text("Revoke access", "Erişimi kaldır", "لغو دسترسی")}
                          confirmLabel={text("Confirm revoke", "Kaldırmayı onayla", "تأیید لغو")}
                          variant="danger"
                        />
                      </>
                    ) : (
                      <ReasonAction
                        endpoint="staff"
                        body={{ action: "reinstate", userId: member.userId }}
                        label={text("Reinstate access", "Erişimi geri ver", "بازگرداندن دسترسی")}
                        confirmLabel={text(
                          "Confirm reinstate",
                          "Geri vermeyi onayla",
                          "تأیید بازگرداندن"
                        )}
                        fields={[
                          {
                            key: "role",
                            kind: "select",
                            label: text("Role", "Rol", "نقش"),
                            defaultValue: member.role,
                            options: [
                              { value: "platform_support", label: "platform_support" },
                              { value: "platform_admin", label: "platform_admin" },
                              { value: "platform_owner", label: "platform_owner" }
                            ]
                          }
                        ]}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>{text("Grant access", "Erişim ver", "اعطای دسترسی")}</h2>
          </div>
          <p className="section-note">
            {text(
              "Paste the account's user id. Find it on the People screen — the person must already have an account.",
              "Hesabın kullanıcı kimliğini yapıştırın. Kişiler ekranında bulabilirsiniz — kişinin zaten bir hesabı olmalıdır.",
              "شناسه کاربر حساب را بچسبانید. آن را در صفحه افراد پیدا کنید — شخص باید از قبل حساب داشته باشد."
            )}
          </p>
          <GrantForm />
        </section>
      </div>
    </AdminShell>
  );
}

function GrantForm() {
  const { text } = useI18n();
  return (
    <div className="admin-grant-form">
      <ReasonAction
        endpoint="staff"
        body={{ action: "grant" }}
        label={text("Grant staff access", "Personel erişimi ver", "اعطای دسترسی کارکنان")}
        confirmLabel={text("Confirm grant", "Vermeyi onayla", "تأیید اعطا")}
        fields={[
          {
            key: "userId",
            kind: "text",
            label: text("Account user id", "Hesap kullanıcı kimliği", "شناسه کاربر حساب"),
            defaultValue: ""
          },
          {
            key: "role",
            kind: "select",
            label: text("Role", "Rol", "نقش"),
            defaultValue: "platform_support",
            options: [
              { value: "platform_support", label: "platform_support" },
              { value: "platform_admin", label: "platform_admin" },
              { value: "platform_owner", label: "platform_owner" }
            ]
          }
        ]}
      />
    </div>
  );
}
