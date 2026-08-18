import Image from "next/image";
import Link from "next/link";

export function BrandLockup({ context }: { context?: string }) {
  return (
    <Link className="brand-lockup" href="/dashboard" aria-label="Rellooma">
      <span className="brand-logo" aria-hidden="true">
        <Image
          className="brand-logo-horizontal"
          src="/brand/rellooma-horizontal.png"
          width={944}
          height={319}
          sizes="(max-width: 1050px) 40px, 148px"
          alt=""
          priority
        />
        <Image
          className="brand-logo-mark"
          src="/brand/rellooma-app-icon.png"
          width={426}
          height={437}
          sizes="40px"
          alt=""
          priority
        />
      </span>
      {context ? <span className="brand-context">{context}</span> : null}
    </Link>
  );
}
