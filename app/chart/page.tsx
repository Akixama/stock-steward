import type {Metadata} from 'next';
import MarketChart from './market-chart';
import './chart.css';

export const metadata:Metadata={title:'Markets & charts — Stock Steward',description:'Explore current Robinhood Chain stock-token quotes and Stock Steward’s recorded price observations.'};

export default function ChartPage(){return <MarketChart/>;}
