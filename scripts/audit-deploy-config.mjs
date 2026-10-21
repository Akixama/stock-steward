import fs from 'node:fs';
import { publicTradingVars } from './public-trading-release.mjs';
const file='dist/server/wrangler.json';const config=JSON.parse(fs.readFileSync(file,'utf8'));
const release=JSON.parse(fs.readFileSync('config/public-trading-release.json','utf8'));
const automatic=JSON.parse(fs.readFileSync('config/automatic-stages-release.json','utf8'));
if(['shadowMode','approveByNotification','autoBuy'].some(key=>typeof automatic[key]!=='boolean')||!Number.isInteger(automatic.autoBuyMaxOrderCents)||!Number.isInteger(automatic.autoBuyMaxDailyCents)||automatic.autoBuyMaxOrderCents<1||automatic.autoBuyMaxOrderCents>100||automatic.autoBuyMaxDailyCents<automatic.autoBuyMaxOrderCents||automatic.autoBuyMaxDailyCents>250||((automatic.approveByNotification||automatic.autoBuy)&&!automatic.shadowMode)||(automatic.approveByNotification&&automatic.autoBuy))throw Error('Invalid automatic stage release config.');
config.name='stock-steward';config.topLevelName='stock-steward';
config.d1_databases[0].database_name='stock-steward-demo-db';
config.d1_databases[0].database_id='c020cd5a-f6cc-4d9c-a9c6-1d2e5fa704f7';
config.routes=[{pattern:'stocksteward.app',custom_domain:true},{pattern:'www.stocksteward.app',custom_domain:true}];
config.ai={binding:'AI'};
config.vars={...config.vars,STEWARD_AI_ENABLED:'true',SHADOW_MODE:String(automatic.shadowMode),APPROVE_BY_NOTIFICATION:String(automatic.approveByNotification),AUTO_BUY:String(automatic.autoBuy),AUTO_BUY_MAX_ORDER_CENTS:String(automatic.autoBuyMaxOrderCents),AUTO_BUY_MAX_DAILY_CENTS:String(automatic.autoBuyMaxDailyCents),...publicTradingVars(release),STEWARD_LIVE_BUY_PILOT_WALLETS:'0xdc7f175bca1c29a77286a52c857e7fef12f3f662'};
// A hosted emergency override must survive builds and deployments. The D1
// trading_controls row is the other live kill switch and is never reset here.
delete config.vars.STEWARD_TRADING_KILL_SWITCH;
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
