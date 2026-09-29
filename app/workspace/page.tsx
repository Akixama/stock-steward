import {env} from 'cloudflare:workers';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {D1DecisionLedger} from '@/db/ledger';
import type {Mandate} from '@/lib/decision';
import WorkspaceClient from './workspace-client';
export const dynamic='force-dynamic';
export default async function WorkspacePage(){const user=await requireChatGPTUser('/workspace');let mandate:Mandate|null=null;let storageError:string|null=null;try{if(!env.DB)throw Error('Database unavailable');mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);}catch(error){console.error('Workspace storage unavailable',error);storageError='Your saved workspace is temporarily unavailable. Please try again shortly.';}return <WorkspaceClient initialMandate={mandate} storageError={storageError}/>;}
