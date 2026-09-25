import type { Metadata } from "next";
import "./globals.css";
import "./steward.css";
import "./landing.css";
import "./transition.css";
import { RouteStage } from "@/components/route-transition";

export const metadata: Metadata = {
  title: "Stock Steward — know what happened and why",
  description: "A clear decision trail for stock investing boundaries and broker-confirmed orders.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><RouteStage>{children}</RouteStage></body>
    </html>
  );
}
