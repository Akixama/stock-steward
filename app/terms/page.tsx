import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal-layout";

export const metadata: Metadata = { title: "Terms · Stock Steward" };

export default function TermsPage() {
  return <LegalLayout eyebrow="TERMS" title="The rules of this service." updated="25 September 2026">
    <p className="legal-lead">These are draft terms for the brokerage edition of Stock Steward. They do not take effect as public service terms until publication wording is reviewed and the service is launched.</p>
    <LegalSection title="What Stock Steward provides"><p>Stock Steward lets a signed-in user save stock-purchase boundaries, request broker-data checks, and inspect decision receipts. When the required broker permission and order switch are active, it may submit an exact order only after the account owner approves that order. Automatic trading and background monitoring are not active in this version.</p></LegalSection>
    <LegalSection title="Your brokerage account"><p>You open, hold, and fund your brokerage account with Alpaca, subject to Alpaca’s own eligibility review and agreements. Stock Steward is an independent application, not Alpaca. Connecting an account grants only the permissions shown during that connection. You are responsible for checking the account and order details before approving a live order.</p></LegalSection>
    <LegalSection title="Markets and decisions"><p>Quotes can become stale, market orders can execute at a different price, and broker availability can change. A receipt records the data Stock Steward received and the checks it performed at a particular time; it is not a guarantee of a future price, fill, return, or loss limit. Saved limits are controls for Stock Steward’s actions and do not block trades placed elsewhere in your brokerage account.</p></LegalSection>
    <LegalSection title="Access and acceptable use"><p>Use only an account you are authorized to access. Do not misrepresent your identity or location to obtain a brokerage service unavailable to you. You may disconnect Stock Steward’s broker token from the workspace. Your broker may also provide controls to revoke app access.</p></LegalSection>
    <LegalSection title="Availability and changes"><p>This edition is under development. Features may be unavailable while a broker connection, hosting service, or market-data source is unavailable. We may revise these terms as the product changes; an updated page will show a new revision date. Contact: <a href="mailto:stocksteward.support@gmail.com">stocksteward.support@gmail.com</a>.</p></LegalSection>
  </LegalLayout>;
}
