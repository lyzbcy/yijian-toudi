const test=require('node:test'),assert=require('node:assert/strict');
const {contracts}=require('./login-gate-contract.cjs');
test('production form and native diagnostics agree on visible auth iframe and login routes',async()=>{
 const r=await contracts();assert.equal(r.passed,r.total,JSON.stringify(r.checks.filter(c=>!c.ok)));
});
