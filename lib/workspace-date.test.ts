import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { PermissionReview, type PermissionReviewPayload } from '../app/workspace/permission-review.ts';
import { formatWorkspaceDate } from './workspace-date.ts';

const expiry = Date.parse('2026-10-22T00:00:00Z') / 1000;
const review: PermissionReviewPayload = {
  kind: 'renew', digest: 'review-digest',
  review: {
    safe: '0x571200000000000000000000000000000000493d',
    module: '0x1111111111111111111111111111111111111111',
    capRaw: '20000000',
    spenders: {
      token: '0x2222222222222222222222222222222222222222',
      permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
      router: '0x204FAca1764B154221e35c0d20aBb3c525710498',
    },
    expiresAt: expiry,
    estimatedNetworkFeeEth: '0.0001',
    revocation: 'You can revoke both approvals at any time.',
  },
};

function renderReview(payload: PermissionReviewPayload) {
  return renderToString(createElement(PermissionReview, {
    preview: payload, busy: false, hasProvider: true,
    onConfirm: () => {}, onCancel: () => {},
  }));
}

test('Renew review renders a real-shaped payload and expiry without throwing', () => {
  const html = renderReview(review);
  assert.match(html, /Renew buying access/);
  assert.match(html, /20 USDG/);
  assert.match(html, /Oct.*2026/);
  assert.match(html, /0\.0001 ETH/);
  assert.match(html, /Technical details/);
  assert.doesNotMatch(html.split('Technical details')[0], /Permit2|Trade router/);
  assert.match(html, /Confirm exact action in wallet/);
});

test('Renew review survives missing, null, and invalid expiry values', () => {
  for (const expiresAt of [undefined, null, 'not a timestamp']) {
    const payload = { ...review, review: { ...review.review, expiresAt } } as unknown as PermissionReviewPayload;
    assert.match(renderReview(payload), /Date unavailable/);
  }
});

test('invalid locale option combination falls back to a stable ISO UTC date', () => {
  assert.equal(formatWorkspaceDate(expiry, {
    dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short',
  }, 'seconds'), '2026-10-22 00:00 UTC');
  assert.equal(formatWorkspaceDate(null), 'Date unavailable');
  assert.equal(formatWorkspaceDate('bad date'), 'Date unavailable');
});
