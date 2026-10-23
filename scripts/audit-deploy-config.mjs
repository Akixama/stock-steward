import fs from 'node:fs';
import { publicTradingVars } from './public-trading-release.mjs';
const file='dist/server/wrangler.json';const config=JSON.parse(fs.readFileSync(file,'utf8'));
const release=JSON.parse(fs.readFileSync('config/public-trading-release.json','utf8'));
const automatic=JSON.parse(fs.readFileSync('config/automatic-stages-release.json','utf8'));
if(['shadowMode','approveByNotification','autoBuy'].some(key=>typeof automatic[key]!=='boolean')||!Number.isInteger(automatic.autoBuyMaxOrderCents)||!Number.isInteger(automatic.autoBuyMaxDailyCents)||automatic.autoBuyMaxOrderCents<1||automatic.autoBuyMaxOrderCents>100||automatic.autoBuyMaxDailyCents<automatic.autoBuyMaxOrderCents||automatic.autoBuyMaxDailyCents>250||((automatic.approveByNotification||automatic.autoBuy)&&!automatic.shadowMode)||(automatic.approveByNotification&&automatic.autoBuy))throw Error('Invalid automatic stage release config.');
if(automatic.autoBuyHardCeilingCents!==500||automatic.autoBuyMaxDailyCents*2>automatic.autoBuyHardCeilingCents)throw Error('Invalid automatic hard ceiling.');
for(const key of ['approveNotificationWallets','autoBuyWallets'])if(!Array.isArray(automatic[key])||automatic[key].some(value=>typeof value!=='string'||!/^0x[0-9a-f]{40}$/i.test(value)))throw Error('Invalid automatic stage wallet allowlist.');
config.name='stock-steward';config.topLevelName='stock-steward';
config.d1_databases[0].database_name='stock-steward-demo-db';
config.d1_databases[0].database_id='c020cd5a-f6cc-4d9c-a9c6-1d2e5fa704f7';
config.routes=[{pattern:'stocksteward.app',custom_domain:true},{pattern:'www.stocksteward.app',custom_domain:true}];
// Keep the framework's generated Worker intact. The small wrapper adds a
// scheduled wake-up that dispatches the already-authenticated monitor route.
// This is required for background Shadow checks; no browser needs to stay open.
config.main='scheduled-entry.js';
config.triggers={crons:['*/15 * * * *']};
fs.writeFileSync('dist/server/scheduled-entry.js',`import site from './index.js';
export default {
  fetch(request, env, ctx) { return site.fetch(request, env, ctx); },
  scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      if (!env.STEWARD_WORKER_KEY) throw Error('Background monitor key unavailable.');
      const response = await site.fetch(new Request('https://stocksteward.app/api/internal/monitor/tick', {
        method: 'POST', headers: { Authorization: 'Bearer ' + env.STEWARD_WORKER_KEY }
      }), env, ctx);
      if (!response.ok) throw Error('Background monitor failed with HTTP ' + response.status);
    })());
  }
};
`);
config.ai={binding:'AI'};
config.vars={...config.vars,STEWARD_AI_ENABLED:'true',SHADOW_MODE:String(automatic.shadowMode),APPROVE_BY_NOTIFICATION:String(automatic.approveByNotification),APPROVE_NOTIFICATION_WALLETS:automatic.approveNotificationWallets.join(','),AUTO_BUY:String(automatic.autoBuy),AUTO_BUY_WALLETS:automatic.autoBuyWallets.join(','),AUTO_BUY_MAX_ORDER_CENTS:String(automatic.autoBuyMaxOrderCents),AUTO_BUY_MAX_DAILY_CENTS:String(automatic.autoBuyMaxDailyCents),AUTO_BUY_HARD_CEILING_CENTS:String(automatic.autoBuyHardCeilingCents),...publicTradingVars(release),STEWARD_LIVE_BUY_PILOT_WALLETS:'0xdc7f175bca1c29a77286a52c857e7fef12f3f662'};
// A hosted emergency override must survive builds and deployments. The D1
// trading_controls row is the other live kill switch and is never reset here.
delete config.vars.STEWARD_TRADING_KILL_SWITCH;
fs.writeFileSync(file,JSON.stringify(config,null,2)+'\n');
