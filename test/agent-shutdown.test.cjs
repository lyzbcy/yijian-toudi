'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {cases}=require('./agent-shutdown-contract.cjs');
for(const [name,run] of cases)test('Agent shutdown '+name,async()=>{const result=await run();assert.equal(result.ok,true,JSON.stringify(result));});
