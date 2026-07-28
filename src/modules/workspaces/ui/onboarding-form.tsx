"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
const steps = [
  ["account", "Create account", "Your private workspace exists.", "/onboarding"],
  ["business-profile", "Business profile", "Add brand and business hours.", "/settings"],
  ["knowledge", "Brand, pricing and FAQs", "Approve the facts automation can use.", "/settings"],
  ["ai-provider", "AI provider", "Choose paid, BYOK or synthetic Demo.", "/settings"],
  ["channels", "Connect and test channels", "Use Sandbox until Meta is approved.", "/connections"],
  ["automation", "Create first automation", "Choose one supported recipe.", "/automations"],
  ["test", "Run safe test", "Verify questions, windows and handoff.", "/automations"],
  ["activate", "Activate", "Turn on after every check passes.", "/automations"]
] as const;
async function csrf() {
  return ((await fetch("/api/auth/csrf").then((r) => r.json())) as { token: string }).token;
}
export function OnboardingForm({ initialCompleted }: { initialCompleted: readonly string[] }) {
  const router = useRouter();
  const [completed, setCompleted] = useState([...initialCompleted]);
  const [busy, setBusy] = useState("");
  async function done(step: string) {
    setBusy(step);
    const response = await fetch("/api/onboarding/progress", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-csrf-token": await csrf() },
      body: JSON.stringify({ step })
    });
    if (response.ok) setCompleted((prev) => [...new Set([...prev, step])]);
    setBusy("");
  }
  async function enter() {
    await done("account");
    const token = await csrf();
    const response = await fetch("/api/onboarding/complete", {
      method: "POST",
      headers: { "x-csrf-token": token }
    });
    if (response.ok) {
      router.push("/dashboard");
      router.refresh();
    }
  }
  return (
    <section className="onboarding-steps" aria-label="Setup progress">
      {steps.map(([id, title, detail, href], index) => {
        const ready = completed.includes(id) || id === "account";
        return (
          <article key={id} className={ready ? "complete" : ""}>
            <span className="onboarding-number">{ready ? "✓" : index + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{detail}</p>
            </div>
            <div className="onboarding-actions">
              {id === "account" ? (
                <button onClick={enter}>Enter sandbox workspace</button>
              ) : (
                <>
                  <Link href={href}>Open</Link>
                  <button className="button-muted" onClick={() => done(id)} disabled={busy === id}>
                    {busy === id ? "Saving…" : "Mark complete"}
                  </button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
