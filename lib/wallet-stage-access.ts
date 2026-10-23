import {getOwnership} from '../db/wallet-ownership.ts';
import {automaticStages,stagesForWallet,type AutomaticStageConfig} from './automatic-stages.ts';

export async function ownerAutomaticStages(db:D1Database,owner:string,config:AutomaticStageConfig){
  const ownership=await getOwnership(db,owner);
  return stagesForWallet(automaticStages(config),ownership?.verifiedAt?ownership.address:null);
}
