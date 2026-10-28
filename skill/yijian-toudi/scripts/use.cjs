#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),{resolveSnapshot,kickoff}=require('./bootstrap.cjs');
function use({owner=path.resolve(__dirname,'..'),env=process.env,now=new Date(),spawnImpl,selectedSnapshot}={}){const snapshot=selectedSnapshot||resolveSnapshot(owner,env);if(snapshot.root!==fs.realpathSync(path.resolve(__dirname,'..')))return require(path.join(snapshot.root,'scripts/use.cjs')).use({owner,env,now,spawnImpl,selectedSnapshot:snapshot});kickoff(snapshot,{env,now,spawnImpl});return{version:snapshot.version,root:snapshot.root,bootstrapRoot:snapshot.bootstrapRoot,instructions:path.join(snapshot.root,'SKILL.md'),deployment:path.join(snapshot.root,'references/deploy.md'),dailyScript:path.join(snapshot.bootstrapRoot,'scripts/daily-boss.cjs')};}
if(require.main===module){try{console.log(JSON.stringify(use()));}catch{process.exitCode=1;}}
module.exports={use};
