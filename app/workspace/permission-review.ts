'use client';

import { Component, createElement as h, type ReactNode } from 'react';
import { formatUnits } from 'viem';
import { formatWorkspaceDate } from '../../lib/workspace-date.ts';

export type PermissionReviewPayload = {
  kind: 'renew' | 'revoke'; digest: string;
  review: {
    safe: string; module: string; capRaw: string;
    spenders: { token: string; permit2: string; router: string };
    expiresAt: number | null; estimatedNetworkFeeEth: string; revocation: string;
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
    h('h3', null, renew ? 'Review renewal on the same wallet' : 'Review revocation'),
    h('dl', null,
      row('Steward wallet', h('code', null, preview.review.safe)),
      row(renew ? 'New total USDG cap' : 'Approvals after revocation', `${formatUnits(BigInt(preview.review.capRaw), 6)} USDG`),
      row('USDG token approves', ['Permit2 ', h('code', { key: 'permit2' }, preview.review.spenders.permit2)]),
      row('Permit2 approves', ['Trade router ', h('code', { key: 'router' }, preview.review.spenders.router)]),
      row('Expiry', renew ? formatWorkspaceDate(preview.review.expiresAt, undefined, 'seconds') : 'Approvals cleared now'),
      row('Estimated network fee', `${preview.review.estimatedNetworkFeeEth} ETH · your wallet shows the actual fee`),
    ),
    h('p', null, preview.review.revocation),
    h('p', null, 'Approval changes do not transfer funds. Your owner wallet signs the exact Safe transaction once.'),
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
