const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),{EventEmitter}=require('node:events'),{requestJson}=require('../electron/feedback.cjs'),{postJson}=require('../electron/wecom-notify.cjs');
test('feedback and WeCom TLS explicitly verifies certificates even with inherited unsafe env',async()=>{
 const original=https.request,seen=[];https.request=(_url,options,callback)=>{seen.push(options.rejectUnauthorized);const request=new EventEmitter();request.end=()=>{const response=new EventEmitter();response.statusCode=200;callback(response);process.nextTick(()=>{response.emit('data',Buffer.from('{"errcode":0}'));response.emit('end');});};return request;};
 try{await requestJson(new URL('https://feedback.example/v1/feedback'),{});await postJson('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fixture',{});assert.deepEqual(seen,[true,true]);}finally{https.request=original;}
});
