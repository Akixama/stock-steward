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
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || href === pathname) return;
    event.preventDefault();
    if (document.documentElement.classList.contains("route-leaving")) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push(href);
      return;
    }
    document.documentElement.classList.add("route-leaving");
    window.setTimeout(() => {
      router.push(href);
      window.setTimeout(() => document.documentElement.classList.remove("route-leaving"), 700);
    }, 170);
  }

  return <Link href={href} className={className} aria-label={ariaLabel} onClick={navigate}>{children}</Link>;
}
