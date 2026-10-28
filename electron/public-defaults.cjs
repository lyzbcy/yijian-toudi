// Only public configuration is bundled. No webhook, token, profile or outbox.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{endpointUrl}=require('./feedback.cjs');
function ipNumber(host){
 if(net.isIP(host)===4)return host.split('.').reduce((n,x)=>(n<<8n)+BigInt(x),0n);
 const halves=host.split('::'),left=halves[0]?halves[0].split(':'):[],right=halves[1]?halves[1].split(':'):[];
 const words=halves.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
 return words.reduce((n,x)=>(n<<16n)+BigInt('0x'+x),0n);
}
function inBlock(host,cidr){const [base,bits]=cidr.split('/'),size=net.isIP(host)===4?32:128,shift=BigInt(size-Number(bits));return(ipNumber(host)>>shift)===(ipNumber(base)>>shift);}
function publicHost(host){
 host=host.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();const type=net.isIP(host);
 if(type===4){if(['192.0.0.9','192.0.0.10'].includes(host))return true;const denied=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/3'];return !denied.some(c=>inBlock(host,c));}
 if(type===6){
  const denied=['::/96','::ffff:0:0/96','64:ff9b:1::/48','100::/64','100:0:0:1::/64','2001:2::/48','2001:db8::/32','3fff::/20','5f00::/16','fc00::/7','fe80::/10','ff00::/8'];
  if(denied.some(c=>inBlock(host,c)))return false;
  const exceptions=['2001:1::1/128','2001:1::2/128','2001:1::3/128','2001:3::/32','2001:4:112::/48','2001:20::/28','2001:30::/28'];
  if(inBlock(host,'2001::/23')&&!exceptions.some(c=>inBlock(host,c)))return false;
  return inBlock(host,'2000::/3')||inBlock(host,'64:ff9b::/96');
 }
 if(!host.includes('.')||!host.split('.').every(x=>/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x)))return false;
 return !['localhost','local','internal','lan','home','corp','home.arpa','test','invalid','example','example.com','example.net','example.org'].some(s=>host===s||host.endsWith('.'+s));
}
function publicEndpoint(value,{allowEmpty=false}={}){
 if(typeof value!=='string'||value!==value.trim()||value.length>2048)throw Error('feedback-public-endpoint-invalid');
 if(value===''){if(allowEmpty)return '';throw Error('feedback-public-endpoint-required');}
 let u;try{u=endpointUrl(value);}catch{throw Error('feedback-public-endpoint-invalid');}
 if(u.protocol!=='https:'||!publicHost(u.hostname))throw Error('feedback-public-endpoint-not-public');
 return u.href;
}
function readPublicDefaults(file=path.join(__dirname,'public-defaults.json'),{requireConfigured=false}={}){
 const bytes=fs.readFileSync(file);if(bytes.length>4096)throw Error('public-defaults-too-large');let data;
 try{data=JSON.parse(bytes.toString('utf8'));}catch{throw Error('public-defaults-invalid');}
 if(!data||Array.isArray(data)||data.schema!==1||Object.keys(data).sort().join(',')!=='feedbackEndpoint,schema')throw Error('public-defaults-invalid');
 return{schema:1,feedbackEndpoint:publicEndpoint(data.feedbackEndpoint,{allowEmpty:!requireConfigured})};
}
function getPublicDefaults(){try{return readPublicDefaults();}catch{return{schema:1,feedbackEndpoint:''};}}
function normalizeFeedbackPatch(patch,defaults=getPublicDefaults()){
 const out={...patch};delete out.feedbackEndpointOverride;
 if(Object.hasOwn(out,'feedbackEndpoint')){
  if(typeof out.feedbackEndpoint!=='string')throw Error('feedback-endpoint-invalid');
  out.feedbackEndpoint=out.feedbackEndpoint.trim();if(out.feedbackEndpoint)out.feedbackEndpoint=endpointUrl(out.feedbackEndpoint).href;
  out.feedbackEndpointOverride=out.feedbackEndpoint===''||out.feedbackEndpoint!==defaults.feedbackEndpoint;
 }
 return out;
}
module.exports={publicHost,publicEndpoint,readPublicDefaults,getPublicDefaults,normalizeFeedbackPatch};
