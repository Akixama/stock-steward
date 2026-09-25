import { evaluateBuy, type BrokerSnapshot, type DecisionReceipt, type Mandate, type ProposedBuy } from "./decision.ts";

/** Only an authenticated server-side broker integration may implement this interface. */
export interface BrokerReader {
  readonly source: string;
  readSnapshot(accountRef: string, symbol: string): Promise<BrokerSnapshot>;
}

export interface DecisionLedger {
  getMandate(ownerRef: string): Promise<Mandate | null>;
  saveDecision(ownerRef: string, receipt: DecisionReceipt): Promise<void>;
}

export type BrokerCheckRequest = {
  ownerRef: string;
  accountRef: string;
  proposal: ProposedBuy;
};

/** No browser supplied account figures or policy version enter the decision path. */
export async function checkWithBroker(
  broker: BrokerReader,
  ledger: DecisionLedger,
  request: BrokerCheckRequest,
  now?: Date,
): Promise<DecisionReceipt> {
  if (!request.ownerRef || !request.accountRef || !/^[A-Z.]{1,8}$/.test(request.proposal.symbol)) {
    throw new Error("Owner, account, and stock symbol are required. No decision was made.");
  }
  const mandate = await ledger.getMandate(request.ownerRef);
  if (!mandate) throw new Error("No account-bound mandate exists. No decision was made.");
  const evidence = await broker.readSnapshot(request.accountRef, request.proposal.symbol);
  if (broker.source !== evidence.source || evidence.accountRef !== request.accountRef || evidence.symbol !== request.proposal.symbol) {
    throw new Error("Broker response does not match the requested account and stock. No decision was made.");
  }
  // Take the decision time after the broker read, so slow responses cannot refresh old quotes.
  const receipt = evaluateBuy(mandate, evidence, request.proposal, now ?? new Date());
  await ledger.saveDecision(request.ownerRef, receipt);
  return receipt;
}
