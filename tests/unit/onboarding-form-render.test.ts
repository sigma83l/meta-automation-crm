import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The theme and language controls in the stage header read the app router,
// which only exists inside a Next render. Stubbed rather than removed from the
// render: their presence in the header is part of what is being checked.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { OnboardingForm } from "@/src/modules/workspaces/ui/onboarding-form";

/**
 * The server render, which is the one nobody sees fail.
 *
 * Every control on this screen lives in an `onClick` or an `onChange`, so the
 * first paint is the only version of the page that exists until React arrives
 * - and a stage that throws during it takes the whole route down for a person
 * who has just signed up. These assertions are deliberately about markup
 * rather than behaviour: what is rendered before hydration, and whether it says
 * the true thing while it cannot act.
 */
function render(stage: string, data: Record<string, Record<string, unknown>> = {}) {
  return renderToStaticMarkup(
    createElement(OnboardingForm, {
      initialStage: stage,
      initialCompleted: [],
      initialSkipped: [],
      initialData: data as never
    })
  );
}

describe("onboarding form, server render", () => {
  it("opens on the business name and offers only real languages", () => {
    const html = render("welcome");
    expect(html).toContain('name="workspaceName"');
    expect(html).toContain("Deniz Coffee");
    expect(html).toContain('value="tr"');
    expect(html).not.toContain("jgwejf");
  });

  it("renders seven days and the answer they produce", () => {
    const html = render("hours");
    for (const day of ["Monday", "Saturday", "Sunday"]) expect(html).toContain(day);
    // Weekdays open by default and the weekend closed, so a person who agrees
    // by pressing Continue stores hours rather than `{}`.
    expect(html.match(/type="time"/g) ?? []).toHaveLength(10);
    expect(html).toContain("What are your opening hours?");
    expect(html).toContain("Monday: 09:00 to 18:00");
    expect(html).toContain("Saturday: closed");
  });

  it("selects the paid platform mode and warns about the one that cannot answer", () => {
    const html = render("assistant");
    expect(html).toContain('value="PLATFORM_PAID_DEFAULT" selected=""');
    expect(html).toContain("Included with your plan (recommended)");
    expect(html).not.toContain('value="FREE_GEMINI_DEMO_SYNTHETIC_ONLY" selected=""');

    const demo = render("assistant", { assistant: { mode: "FREE_GEMINI_DEMO_SYNTHETIC_ONLY" } });
    expect(demo).toContain('role="alert"');
    expect(demo).toContain("no customer gets a reply");
  });

  it("reports what is still missing before the workspace leaves setup", () => {
    const bare = render("connect");
    expect(bare.match(/class="pending"/g) ?? []).toHaveLength(1);

    const answered = render("connect", {
      knowledge: {
        faqQuestion: "Do you deliver to the city centre?",
        faqAnswer: "Yes, we deliver every weekday.",
        currency: "TRY"
      }
    });
    expect(answered).not.toContain('class="pending"');
  });

  it("disables the controls it cannot yet run", () => {
    // See use-hydrated: a button whose whole behaviour is an onClick is inert
    // until React arrives, and saying so is better than looking ready.
    expect(render("welcome").match(/<button[^>]*disabled=""/g) ?? []).not.toHaveLength(0);
  });
});
