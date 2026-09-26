import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal-layout";

export const metadata: Metadata = { title: "Terms · Stock Steward" };

export default function TermsPage() {
  return <LegalLayout eyebrow="TERMS" title="The rules of this service." updated="25 September 2026">
    <p className="legal-lead">These terms describe Stock Steward’s early-access preview. Stock Steward is an independent project for setting stock-purchase boundaries and inspecting why a proposed action was held or allowed.</p>
    <LegalSection title="What is available"><p>You can save a versioned mandate and review your workspace. A broker connection, real-account decision check, and live order submission are not configured on this deployment today. The landing-page walkthrough uses illustrative figures, not a broker account. Automatic trading and background monitoring are not active.</p></LegalSection>
    <LegalSection title="Your brokerage account"><p>You open, own, and fund any brokerage account with the broker, subject to its eligibility decisions and agreements. Stock Steward is not Alpaca and does not control those decisions. Connect only an account you are authorized to use. Do not misstate your identity or location to obtain access. Broker permission is separate from your Stock Steward sign-in.</p></LegalSection>
    <LegalSection title="Decisions and orders"><p>Your mandate limits actions taken through Stock Steward; it cannot block trades made elsewhere. A receipt records the information received and rules checked at a particular time. A quote or check cannot guarantee an execution price, fill, return, or maximum loss. If live ordering is enabled after testing and broker approval, you must separately grant trading permission and approve the exact symbol and amount before each order. An uncertain broker response may require a status lookup; it is not treated as a confirmed trade or automatically retried.</p></LegalSection>
    <LegalSection title="Availability and changes"><p>This project is under development. Broker, market-data, hosting, or sign-in services may be unavailable, and features may change. We will update this page when the terms change. You may stop using Stock Steward and request deletion of local workspace data as described in the <a href="/privacy">Privacy notice</a>.</p></LegalSection>
    <LegalSection title="Contact"><p>Stock Steward operates under the Stock Steward name. Questions about these terms can be sent to <a href="mailto:stocksteward.support@gmail.com">stocksteward.support@gmail.com</a>.</p></LegalSection>
  </LegalLayout>;
}
