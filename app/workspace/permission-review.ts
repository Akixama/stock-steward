'use client';

import { Component, createElement as h, type ReactNode } from 'react';
import { formatUnits } from 'viem';
import { formatWorkspaceDate } from '../../lib/workspace-date.ts';

export type PermissionReviewPayload = {
  kind: 'renew' | 'revoke'; digest: string; reviewToken?: string;
  review: {
    safe: string; module: string; capRaw: string;
    spenders: { token: string; permit2: string; router: string };
    expiresAt: number | null; estimatedNetworkFeeEth: string; revocation: string;
    calls?: { to: string; data: string }[];
  };
};

function row(label: string, value: ReactNode) {
  return h('div', { key: label }, h('dt', null, label), h('dd', null, value));
}

export function PermissionReview({ preview, busy, hasProvider, onConfirm, onCancel }: {
  preview: PermissionReviewPayload; busy: boolean; hasProvider: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const renew = preview.kind === 'renew';
  return h('div', { className: 'ws-maintenance-review', role: 'group', 'aria-label': renew ? 'Renewal review' : 'Revocation review' },
    h('h3', null, renew ? 'Renew buying access' : 'Turn off buying access'),
    h('p', null, renew
      ? `Keep using this Steward wallet. Buying can use up to ${formatUnits(BigInt(preview.review.capRaw), 6)} USDG until ${formatWorkspaceDate(preview.review.expiresAt, undefined, 'seconds')}.`
      : 'Turn off buying and clear both spending approvals. Your holdings stay in your wallet.'),
    h('p', null, `Estimated network fee: ${preview.review.estimatedNetworkFeeEth} ETH. Your wallet shows the actual fee before you sign.`),
    h('p', null, 'This does not move your funds. You can turn buying off at any time.'),
    h('details', { className: 'ws-maintenance-technical' },
      h('summary', null, 'Technical details'),
      h('dl', null,
        row('Steward wallet', h('code', null, preview.review.safe)),
        row('Permission module', h('code', null, preview.review.module)),
        row('Exact cap', `${formatUnits(BigInt(preview.review.capRaw), 6)} USDG (${preview.review.capRaw} raw units)`),
        row('USDG token', h('code', null, preview.review.spenders.token)),
        row('Token spender', h('code', null, preview.review.spenders.permit2)),
        row('Next spender', h('code', null, preview.review.spenders.router)),
        row('Exact expiry', renew ? formatWorkspaceDate(preview.review.expiresAt, undefined, 'seconds') : 'Cleared immediately'),
        row('Estimated network fee', `${preview.review.estimatedNetworkFeeEth} ETH`),
        row('Call fingerprint', h('code', null, preview.digest)),
      ),
      h('p', null, preview.review.revocation),
      preview.review.calls?.map((call, index) => h('p', { key: index },
        `Call ${index + 1} to `, h('code', null, call.to), ' · ', h('code', null, call.data))),
    ),
    h('div', null,
      h('button', { type: 'button', onClick: onConfirm, disabled: busy || !hasProvider }, busy ? 'Checking…' : 'Confirm exact action in wallet'),
      h('button', { type: 'button', onClick: onCancel, disabled: busy }, 'Cancel review'),
    ),
  );
}

export class PermissionReviewBoundary extends Component<{ children: ReactNode; fallback: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? h('p', { role: 'alert', className: 'ws-error' }, this.props.fallback)
      : this.props.children;
  }
}
