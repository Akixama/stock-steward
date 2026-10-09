import {env} from 'cloudflare:workers';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {D1DecisionLedger} from '@/db/ledger';
import type {Mandate} from '@/lib/decision';
import {getAlpacaConnection,alpacaOrderSubmissionEnabled,alpacaEnvironment} from '@/lib/alpaca-connection';
import WorkspaceClient from './workspace-client';
import type {BrokerStatus} from './broker-panel';
export const dynamic='force-dynamic';
export default async function WorkspacePage(){
  const user=await requireChatGPTUser('/workspace');
  let mandate:Mandate|null=null;
  let brokerStatus:BrokerStatus=null;
  let storageError:string|null=null;
  try{
    if(!env.DB)throw Error('Database unavailable');
    mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);
  }catch(error){
    console.error('Workspace storage unavailable',error);
    storageError='Your saved workspace is temporarily unavailable. Please try again shortly.';
  }
  try{
    if(env.DB){
      const connection=await getAlpacaConnection(env.DB,user.userId);
      brokerStatus=connection?{environment:connection.environment,connectedAt:connection.connectedAt,tradingScope:connection.tradingScope,orderSubmissionEnabled:alpacaOrderSubmissionEnabled(alpacaEnvironment())}:null;
    }
  }catch(error){console.error('Broker status unavailable',error);}
  return <WorkspaceClient initialMandate={mandate} brokerStatus={brokerStatus} storageError={storageError}/>;
}
