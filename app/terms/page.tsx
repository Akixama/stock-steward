import type { Metadata } from "next";
import { LegalLayout, LegalSection } from "@/components/legal-layout";
import { GUARDRAIL_COPY, TERMS_VERSION, TRADE_AGREEMENT_LABEL, TRADING_RISK_TEXT, US_RESTRICTION_TEXT } from '@/config/public-launch-copy';

export const metadata: Metadata = { title: "Terms · Stock Steward" };

export default function TermsPage() {
  return <LegalLayout eyebrow="TERMS" title="The rules of this service." updated={TERMS_VERSION}>
    <p className="legal-lead">{GUARDRAIL_COPY} These terms describe the conditions and risks of using Stock Steward.</p>
    <LegalSection title="What is available"><p>You can save limits, practice with simulated funds, connect a wallet on Robinhood Chain, and manually review Buy, Sell and Send actions. Each real action needs your wallet signature. Background rule checks save receipts and spend nothing; notification approval and autonomous buying are off. The landing-page walkthrough is illustrative.</p></LegalSection>
    <LegalSection title="Your wallet"><p>Use only a wallet you control for ownership verification. Public addresses can be watched without proving ownership. Connecting a wallet, saving limits and signing an ownership message do not grant trading authority.</p></LegalSection>
    <LegalSection title="Decisions and purchases"><p>Practice purchases use fake funds. Your limits govern actions through Stock Steward and cannot restrict activity elsewhere. Receipts describe evidence at a particular time and do not guarantee a price, return or maximum loss. Any future broker order would require separate trading consent, saved limits, exact owner approval and verified safeguards. Onchain purchases require separate wallet permission setup, verified limits and your signature for each exact order. The server cannot sign or spend for you. An uncertain transaction is not treated as a confirmed fill or automatically retried.</p></LegalSection>
    <LegalSection title="Real-money risks and first-trade agreement"><p>{TRADING_RISK_TEXT}</p><p>Before your first Buy, Sell or Send action, you must check: “{TRADE_AGREEMENT_LABEL}” We save the date and this terms version to your account. A new version may require you to agree again.</p><p>{US_RESTRICTION_TEXT} Other places may restrict Stock Tokens too. Your declaration and an IP location signal do not establish legal eligibility.</p></LegalSection>
    <LegalSection title="Availability and changes"><p>This project is under development. Network, market-data, hosting, or sign-in services may be unavailable, and features may change. We will update this page when the terms change. You may stop using Stock Steward and request deletion of local workspace data as described in the <a href="/privacy">Privacy notice</a>.</p></LegalSection>
    <LegalSection title="Contact"><p>Stock Steward operates under the Stock Steward name. Questions about these terms can be sent to <a href="mailto:stocksteward.support@gmail.com">stocksteward.support@gmail.com</a>.</p></LegalSection>
  </LegalLayout>;
}
