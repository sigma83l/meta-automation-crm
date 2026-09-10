import type { AiReplyInput } from "@/src/modules/ai/contracts";

/**
 * The workspace voice a test needs but is not testing.
 *
 * `AiReplyInput.business` is required, deliberately: an absent voice is not a
 * smaller prompt, it is a different business's reply. That makes it something
 * every fixture has to supply, and eight copies of the same literal would
 * drift - the first symptom being a test that passes because its own copy
 * happens to omit the field the prompt now reads.
 *
 * Deliberately opinionated rather than empty. A blank brand name and no hours
 * would exercise the branch where the prompt says least, which is the branch a
 * real workspace is never in.
 */
export const TEST_BUSINESS: AiReplyInput["business"] = Object.freeze({
  brandName: "Northstar Studio",
  description: "A small photography studio taking portrait and product bookings.",
  tone: "friendly",
  answerLength: "short",
  emojiPolicy: "limited",
  timezone: "Europe/Istanbul",
  hours: Object.freeze([
    { day: "monday", value: "09:00-17:00" },
    { day: "tuesday", value: "09:00-17:00" }
  ])
});
