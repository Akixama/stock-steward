"use client";

import { useEffect, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function RouteStage({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.classList.remove("route-leaving");
  }, [pathname]);

  return <div className="route-stage" key={pathname}>{children}</div>;
}

export function RouteLink({ href, children, className, "aria-label": ariaLabel }: {
  href: string;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    const current = window.location.pathname + window.location.search;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || href === pathname || href === current) return;
    event.preventDefault();
    if (document.documentElement.classList.contains("route-leaving")) return;
    // The client router can fail inside the runtime; a plain full-page load is the fallback
    // so navigation always works even when the router throws.
    const go = () => {
      const started = window.location.href;
      try { router.push(href); } catch { window.location.assign(href); return; }
      window.setTimeout(() => { if (window.location.href === started && !window.location.href.endsWith(href)) window.location.assign(href); }, 800);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      go();
      return;
    }
    document.documentElement.classList.add("route-leaving");
    window.setTimeout(() => {
      go();
      window.setTimeout(() => document.documentElement.classList.remove("route-leaving"), 700);
    }, 170);
  }

  return <Link href={href} className={className} aria-label={ariaLabel} onClick={navigate} prefetch={false}>{children}</Link>;
}
