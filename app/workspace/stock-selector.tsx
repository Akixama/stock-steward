'use client';

import { useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { StockCatalogItem } from '@/lib/stock-catalog';

const MAX_STOCKS = 3;

export default function StockSelector({ selected, onChange }: {
  selected: string[];
  onChange: (symbols: string[]) => void;
}) {
  const [stocks, setStocks] = useState<StockCatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    fetch('/api/workspace/stocks?memecoins=1', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as { stocks?: StockCatalogItem[]; error?: string };
        if (!response.ok || !payload.stocks) throw new Error(payload.error ?? 'The stock list is unavailable.');
        return payload.stocks;
      })
      .then((items) => { if (active) { setStocks(items); setError(''); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'The stock list is unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  const search = query.trim().toLowerCase();
  const results = stocks.filter((stock) => !search || stock.symbol.toLowerCase().includes(search) || stock.name.toLowerCase().includes(search));
  const selectedSet = new Set(selected);
  const atLimit = selected.length >= MAX_STOCKS;
  const unavailable = stocks.length > 0 ? selected.filter((symbol) => !stocks.some((stock) => stock.symbol === symbol)) : [];

  function toggle(symbol: string) {
    if (selectedSet.has(symbol)) onChange(selected.filter((item) => item !== symbol));
    else if (!atLimit) onChange([...selected, symbol]);
  }

  return <div className="ws-stock-picker ws-field-wide">
    <div className="ws-stock-picker-head"><div><label htmlFor="ws-stock-search">Stocks you can buy</label><p>Choose the stocks you want to allow.</p></div><span>{selected.length} / {MAX_STOCKS} selected</span></div>
    {selected.length > 0 && <div className="ws-stock-selected" aria-label="Selected stocks">{selected.map((symbol) => <button key={symbol} type="button" onClick={() => toggle(symbol)} aria-label={`Remove ${symbol}`}><span>{symbol}</span><X size={13} aria-hidden="true" /></button>)}</div>}
    <div className="ws-stock-search"><Search size={17} aria-hidden="true" /><input id="ws-stock-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Apple, AAPL, Microsoft…" autoComplete="off" aria-controls="ws-stock-results" /></div>
    <div className="ws-stock-list-head"><strong>Available on Robinhood Chain</strong><span>{loading ? 'Loading…' : error ? 'Unavailable' : `${results.length} ${results.length === 1 ? 'stock' : 'stocks'}`}</span></div>
    {loading ? <p className="ws-stock-message" role="status">Loading the current stock list…</p> : error ? <div className="ws-stock-message" role="alert">{error} <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }}>Try again</button></div> : <div id="ws-stock-results" className="ws-stock-results" role="group" aria-label="Available stock tokens">
      {results.length ? results.map((stock) => <button key={stock.symbol} type="button" aria-pressed={selectedSet.has(stock.symbol)} disabled={atLimit && !selectedSet.has(stock.symbol)} onClick={() => toggle(stock.symbol)}><span className="ws-stock-ticker">{stock.symbol}</span><span className="ws-stock-name">{stock.name}{stock.kind === 'memecoin' && <em className="ws-meme-tag">Memecoin · high risk</em>}</span><span className="ws-stock-check">{selectedSet.has(stock.symbol) ? <Check size={16} aria-hidden="true" /> : '+'}</span></button>) : <p className="ws-stock-message">No match. Try a company name or ticker.</p>}
    </div>}
    {selected.some((symbol) => stocks.find((stock) => stock.symbol === symbol)?.kind === 'memecoin') && <p className="ws-stock-warning ws-meme-warning" role="note"><strong>Memecoins can lose most of their value in hours.</strong> While one is in your Limits, each buy is capped at $50. Steward buys it only when you press Buy: no automatic rules and no agent trades.</p>}
    {unavailable.length > 0 && <p className="ws-stock-warning">{unavailable.join(', ')} {unavailable.length === 1 ? 'is' : 'are'} not in the current active list. Remove {unavailable.length === 1 ? 'it' : 'them'} before activating a new permission.</p>}
    <p className="ws-stock-footnote">A real-money permission covers up to three stocks. Final token and route support is checked again before activation.</p>
  </div>;
}
