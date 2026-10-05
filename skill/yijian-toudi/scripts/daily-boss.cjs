#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),{resolveSnapshot,kickoff,dayInShanghai}=require('./bootstrap.cjs');
async function run(options={}){
 const env=options.env||process.env,owner=options.bootstrapRoot||path.resolve(__dirname,'..'),snapshot=options.selectedSnapshot||resolveSnapshot(owner,env);
 if(snapshot.root!==fs.realpathSync(path.resolve(__dirname,'..')))return require(path.join(snapshot.root,'scripts/daily-boss.cjs')).run({...options,env,bootstrapRoot:owner,selectedSnapshot:snapshot});
 // Pin this invocation before the updater starts. A pointer change cannot change
 // its already-selected engine/version or delete its files.
 const engine=require(path.join(snapshot.root,'scripts/boss-engine.cjs'));
 kickoff(snapshot,{env,now:options.now||new Date()});
 return engine.run(options);
}
if(require.main===module)run().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run,dayInShanghai};
