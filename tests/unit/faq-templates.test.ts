import { describe, expect, it } from "vitest";

import {
  FAQ_TEMPLATES,
  missingTemplates,
  type FaqTemplate
} from "@/src/modules/business-profile/faq-templates";

const LOCALES = ["en", "tr", "fa"] as const;

describe("the starter FAQ library", () => {
  it("offers every question in all three languages the app answers in", () => {
    // A template with no Turkish phrasing would silently vanish for a Turkish
    // workspace, which is the locale most of these businesses use.
    for (const template of FAQ_TEMPLATES) {
      for (const locale of LOCALES) {
        expect(`${template.id}.${locale}`).toBe(
          template.question[locale].trim().length > 0 ? `${template.id}.${locale}` : "missing"
        );
        expect(`${template.id}.guidance.${locale}`).toBe(
          template.guidance[locale].trim().length > 0
            ? `${template.id}.guidance.${locale}`
            : "missing"
        );
      }
    }
  });

  it("asks a question rather than naming a topic", () => {
    // The question is stored verbatim and matched against what a customer
    // asked. A heading like "Opening hours" matches nothing anybody types.
    for (const template of FAQ_TEMPLATES) {
      for (const locale of LOCALES) {
        const asked = /[?？؟]$/.test(template.question[locale]);
        expect(`${template.id}.${locale}:${asked}`).toBe(`${template.id}.${locale}:true`);
      }
    }
  });

  it("supplies no answers at all", () => {
    // Deliberate. Only the business knows its own address and policies, and a
    // prefilled answer is one somebody publishes unread.
    for (const template of FAQ_TEMPLATES as readonly (FaqTemplate & { answer?: unknown })[]) {
      expect(`${template.id}:${template.answer === undefined}`).toBe(`${template.id}:true`);
    }
  });

  it("keeps its ids unique, since they key the open row", () => {
    expect(new Set(FAQ_TEMPLATES.map((template) => template.id)).size).toBe(FAQ_TEMPLATES.length);
  });

  it("stops offering a question once it has been answered", () => {
    const hours = FAQ_TEMPLATES.find((template) => template.id === "opening_hours");
    const remaining = missingTemplates([hours!.question.en], "en");
    expect(remaining.map((template) => template.id)).not.toContain("opening_hours");
    expect(remaining.length).toBe(FAQ_TEMPLATES.length - 1);
  });

  it("recognises an answer written in another language", () => {
    // Onboarding writes the opening-hours FAQ in the workspace's reply
    // language. An owner who set up in Turkish and later switched to English
    // has answered this; offering it again invites a second copy that can
    // disagree with the first.
    const hours = FAQ_TEMPLATES.find((template) => template.id === "opening_hours");
    const remaining = missingTemplates([hours!.question.tr], "en");
    expect(remaining.map((template) => template.id)).not.toContain("opening_hours");
  });

  it("ignores casing and stray spacing when matching", () => {
    const hours = FAQ_TEMPLATES.find((template) => template.id === "opening_hours");
    const remaining = missingTemplates([`  ${hours!.question.en.toUpperCase()}  `], "en");
    expect(remaining.map((template) => template.id)).not.toContain("opening_hours");
  });

  it("offers the whole library to a workspace with nothing answered", () => {
    expect(missingTemplates([], "en")).toHaveLength(FAQ_TEMPLATES.length);
    expect(missingTemplates([], "fa")).toHaveLength(FAQ_TEMPLATES.length);
  });

  it("does not treat an unrelated question as an answer to a template", () => {
    expect(missingTemplates(["Do you sell gift cards?"], "en")).toHaveLength(FAQ_TEMPLATES.length);
  });
});
