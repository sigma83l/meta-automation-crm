"use client";

import { useSyncExternalStore } from "react";

/** Never fires: hydration happens once and this store has no later updates. */
const subscribeToNothing = () => () => {};

/**
 * Whether React has taken over the markup this component rendered.
 *
 * A control whose whole behaviour lives in an `onClick` has no fallback before
 * hydration: no form to submit, no href to follow. It is painted, focusable and
 * completely inert, and a click in that window produces nothing - no
 * navigation, no pending state, no error - so the only recovery is to click
 * again, which from the outside is indistinguishable from the product being
 * broken. It is worst right after an action that reloads the page, because that
 * is exactly when someone is already reaching for the next control.
 *
 * Gating `disabled` on this says the true thing instead - the control genuinely
 * is not ready yet - at the cost of a brief disabled state in the first paint.
 * It also makes the behaviour testable: Playwright waits for a control to be
 * enabled before clicking, so the race stops being a flake that appears only
 * when the machine is loaded enough to hydrate slowly.
 *
 * `useSyncExternalStore` rather than a flag set from an effect: it answers "is
 * this the server render" without a state write during mount.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
}
