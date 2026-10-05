const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('APP, README and Skill cloud examples use identical valid TCP forwarding ports',()=>{
 const root=process.env.CLOUD_DOCS_SOURCE_ROOT||path.resolve(__dirname,'..'),files=['src/index.html','README.md','skill/yijian-toudi/references/deploy.md'],seen=[];
 for(const file of files){const text=fs.readFileSync(path.join(root,file),'utf8'),matches=[...text.matchAll(/-R 127\.0\.0\.1:(\d+):127\.0\.0\.1:(\d+)/g)];assert.ok(matches.length,file+' missing forwarding example');for(const m of matches){assert.ok(Number(m[1])>=1&&Number(m[1])<=65535,file+' remote port invalid');assert.ok(Number(m[2])>=1&&Number(m[2])<=65535,file+' local port invalid');seen.push(m[1]+':'+m[2]);new URL('http://127.0.0.1:'+m[1]);}for(const m of text.matchAll(/http:\/\/127\.0\.0\.1:(\d+)/g))new URL(m[0]);}
 assert.equal(new Set(seen).size,1);
});
