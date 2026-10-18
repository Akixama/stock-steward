import assert from 'node:assert/strict';
import test from 'node:test';
import {liveBuyPilotAllowed} from './live-buy-access.ts';

const owner='0xdc7f175bca1c29a77286a52c857e7fef12f3f662';
test('live buying fails closed without an exact configured verified wallet',()=>{
 assert.equal(liveBuyPilotAllowed(owner,undefined),false);
 assert.equal(liveBuyPilotAllowed(owner,'bad-entry'),false);
 assert.equal(liveBuyPilotAllowed(undefined,owner),false);
 assert.equal(liveBuyPilotAllowed('0x'+'1'.repeat(40),owner),false);
 assert.equal(liveBuyPilotAllowed(owner.toUpperCase().replace('0X','0x'),owner),true);
});
