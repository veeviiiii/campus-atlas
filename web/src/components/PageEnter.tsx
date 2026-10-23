"use client";

import { usePathname } from "next/navigation";

/**
 * Re-mounts the page on every route change so its content fades and rises in (CSS: .page-enter).
 * Hash links (/#browse) and tab switches keep the pathname, so they don't replay it.
 */
export default function PageEnter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
