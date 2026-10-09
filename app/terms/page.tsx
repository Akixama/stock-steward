import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal-layout";

export const metadata: Metadata = { title: "Terms · Stock Steward" };

export default function TermsPage() {
  return <LegalLayout eyebrow="TERMS" title="The rules of this service." updated="7 October 2026">
    <p className="legal-lead">These terms describe Stock Steward’s early-access preview. Stock Steward is an independent project for setting stock-purchase boundaries and inspecting why a proposed action was held or allowed.</p>
    <LegalSection title="What is available"><p>You can save limits, review AI-assisted strategies, practice with simulated funds and inspect Robinhood Chain wallet evidence. Practice can run in the workspace or through optional background checks. Live spending remains unavailable. The landing-page walkthrough is illustrative.</p></LegalSection>
    <LegalSection title="Your wallet"><p>Use only a wallet you control for ownership verification. Public addresses can be watched without proving ownership. Connecting a wallet, saving limits and signing an ownership message do not grant trading authority.</p></LegalSection>
    <LegalSection title="Decisions and purchases"><p>Practice purchases use fake funds. Your limits govern actions through Stock Steward and cannot restrict activity elsewhere. Receipts describe evidence at a particular time and do not guarantee a price, return or maximum loss. Any future broker order would require separate trading consent, saved limits, exact owner approval and verified safeguards. Future wallet spending would require a separate wallet permission. An uncertain transaction is not treated as a confirmed fill or automatically retried.</p></LegalSection>
    <LegalSection title="Availability and changes"><p>This project is under development. Network, market-data, hosting, or sign-in services may be unavailable, and features may change. We will update this page when the terms change. You may stop using Stock Steward and request deletion of local workspace data as described in the <a href="/privacy">Privacy notice</a>.</p></LegalSection>
    <LegalSection title="Contact"><p>Stock Steward operates under the Stock Steward name. Questions about these terms can be sent to <a href="mailto:stocksteward.support@gmail.com">stocksteward.support@gmail.com</a>.</p></LegalSection>
  </LegalLayout>;
}
