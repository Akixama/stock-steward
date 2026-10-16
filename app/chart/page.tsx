import type {Metadata} from 'next';
import MarketChart from './market-chart';
import '../workspace/workspace.css';
import './chart.css';

export const metadata:Metadata={title:'Markets & charts — Stock Steward',description:'Browse stock prices and charts, set alerts, and review a manual purchase in Stock Steward.'};

export default function ChartPage(){return <MarketChart/>;}
