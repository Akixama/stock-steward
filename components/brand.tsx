import { useId } from "react";

export function BrandMark({ className = "" }: { className?: string }) {
  const gradientId = `steward-surface-${useId().replace(/:/g, "")}`;
  return (
    <svg className={`brand-symbol ${className}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#45433e" />
          <stop offset="0.45" stopColor="#292824" />
          <stop offset="1" stopColor="#161615" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="38.5" height="38.5" rx="11.25" fill={`url(#${gradientId})`} stroke="#67645d" strokeWidth="1.5" />
      <path d="M28.5 11H14a4 4 0 0 0-4 4v1a4 4 0 0 0 4 4h12a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4H11.5" fill="none" stroke="#f2eee6" strokeWidth="2.65" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 11c1.1-3.5 3.6-5.6 7.4-6.4" fill="none" stroke="#ffffff" strokeOpacity=".2" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  );
}

export function BrandName() {
  return <span className="brand-name">Stock <em>Steward</em></span>;
}
