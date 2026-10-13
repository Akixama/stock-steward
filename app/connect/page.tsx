import {RouteLink} from '@/components/route-transition';
import './connect.css';

export default function ConnectPage() {
  return <main className="archived-connect"><section className="archived-connect__card"><span>ARCHIVED CONNECTION</span><h1>Broker connection is not available.</h1><p>Stock Steward now uses the Robinhood Chain wallet flow. Practice works without a wallet, and every released real purchase requires your wallet approval.</p><RouteLink href="/workspace" className="archived-connect__link">Open workspace</RouteLink></section></main>;
}
