import { env } from 'cloudflare:workers';
import LandingClient from './landing-client';

export const dynamic = 'force-dynamic';

export default function Landing() {
  return <LandingClient publicMode={env.PUBLIC_MODE === 'true'} />;
}
