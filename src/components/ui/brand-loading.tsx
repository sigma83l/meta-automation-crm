import Image from "next/image";

/**
 * The whole-screen wait.
 *
 * A route's `loading.tsx` renders in place of the page, and in this app the
 * workspace shell belongs to the page rather than to a layout - so during a
 * wait the rail, the topbar and the mobile nav are all gone. Dressing that up
 * as a panel produced the worst of both: one small box floating in an empty
 * canvas, framed in the amber that everywhere else in the product means
 * something needs attention.
 *
 * So this owns the screen deliberately instead of pretending the shell is
 * still there: the mark, a ring turning around it, and the name of what is
 * being fetched.
 */
export function BrandLoading({ label, detail }: { label: string; detail?: string }) {
  return (
    <main className="brand-splash" aria-busy="true">
      <div className="brand-splash-inner" role="status">
        <span className="brand-spinner" aria-hidden="true">
          <Image
            className="brand-spinner-mark"
            src="/brand/rellooma-app-icon.png"
            width={426}
            height={437}
            sizes="52px"
            alt=""
            priority
          />
        </span>
        <strong>{label}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
    </main>
  );
}
