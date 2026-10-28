'use strict';
const {inspectPageAuthentication}=require('./page-auth-probe.cjs');
function measureViewport(){
  const auth=inspectAuthentication(),root=document.documentElement,body=document.body;
  function visible(e){if(!e.getClientRects().length)return false;for(let n=e;n;n=n.parentElement){const st=getComputedStyle(n);if(n.hidden||st.display==='none'||st.visibility==='hidden'||st.visibility==='collapse'||Number(st.opacity)===0)return false;}return true;}
  let surfaces=[];
  if(auth.loginRequired){
    const frames=[...document.querySelectorAll('iframe')].filter(e=>{if(!visible(e))return false;try{const u=new URL(e.src,location.href);return location.origin==='https://campus.jd.com'&&u.origin===location.origin&&/^\/passport(?:\/|$)/.test(u.pathname);}catch{return false;}});
    if(frames.length)surfaces=frames;
    else {
      const inputs=[...document.querySelectorAll('input')].filter(e=>visible(e)&&(e.type==='password'||/tel|one-time-code/.test(e.getAttribute('autocomplete')||'')||/phone|mobile|captcha|verify|code|login|pass|手机号|手机|验证码|密码/i.test([e.id,e.name,e.getAttribute('placeholder'),e.getAttribute('aria-label')].join(' '))));
      const qr=[...document.querySelectorAll('[id*=qr],[class*=qr],[id*=QR],[class*=QR]')].filter(visible);
      const dialogs=[...document.querySelectorAll('[role=dialog]')].filter(e=>visible(e)&&[...inputs,...qr].some(n=>e.contains(n)));
      surfaces=dialogs.length?dialogs:[...inputs,...qr].map(e=>e.closest('form,[role=dialog],section,[class*=login],[id*=login],[class*=signin]')||e).filter(e=>e!==root&&e!==body&&visible(e));
    }
  }
  surfaces=[...new Set(surfaces)];
  const rects=surfaces.map(e=>e.getBoundingClientRect());
  const width=auth.loginRequired&&rects.length?Math.max(innerWidth,...rects.map(r=>r.right+scrollX+24)):Math.max(innerWidth,root?.scrollWidth||0,body?.scrollWidth||0);
  const height=rects.length?Math.max(200,...rects.map(r=>r.bottom+scrollY+24)):0;
  return{width:Math.min(20000,width),height:Math.min(20000,height),authSurfaceFound:!auth.loginRequired||surfaces.length>0};
}
const MEASURE_VIEWPORT=`(()=>{const inspectAuthentication=${inspectPageAuthentication.toString()};return (${measureViewport.toString()})();})()`;
// CSS zoom is local to this document. Do not change persisted origin zoom.
function viewportScale({width,height}={},mode='fit',content={width:1366,height:768}) {
  if(mode==='actual')return 1;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return 1;
  return Math.max(.35,Math.min(1,Math.floor(Math.min(width/Math.max(1,content.width),content.height>0?height/content.height:1)*1000)/1000));
}
function createViewportController(webContents,onChange=()=>{}) {
  let mode='fit',bounds={},key=null,epoch=0,disposed=false,queue=Promise.resolve(),state={mode,scale:1,pending:false,tooSmall:false,error:null};
  const alive=()=>!disposed&&!webContents.isDestroyed();
  function notify(){onChange({...state});}
  function refresh(){
    if(!alive())return Promise.resolve({...state});
    const ticket=++epoch,wantedMode=mode,wantedBounds={...bounds};
    state={...state,mode,pending:true,error:null};notify();
    queue=queue.catch(()=>{}).then(async()=>{
      if(!alive()||ticket!==epoch)return;
      const old=key;key=null;
      if(old)await webContents.removeInsertedCSS(old).catch(()=>{});
      if(!alive()||ticket!==epoch)return;
      // Reset before reading intrinsic geometry; CSS removal alone leaves root zoom sticky on Chromium149.
      const reset=await webContents.insertCSS(':root { zoom: 1 !important; }',{cssOrigin:'user'});
      key=reset;
      let content={width:1366,height:768},timer;
      if(wantedMode==='fit'&&webContents.executeJavaScript){try{content=await Promise.race([webContents.executeJavaScript(MEASURE_VIEWPORT),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('viewport-measure-timeout')),1500);})]);}finally{clearTimeout(timer);}}
      if(!alive()||ticket!==epoch){if(!webContents.isDestroyed())await webContents.removeInsertedCSS(reset).catch(()=>{});if(key===reset)key=null;return;}
      if(!Number.isFinite(content.width)||content.width<=0||!Number.isFinite(content.height)||content.height<0)throw Error('viewport-invalid-geometry');
      if(content.authSurfaceFound===false)throw Error('viewport-auth-surface-unknown');
      const scale=viewportScale(wantedBounds,wantedMode,content),ratio=Math.min(wantedBounds.width/content.width,content.height>0?wantedBounds.height/content.height:1);
      const inserted=scale===1?reset:await webContents.insertCSS(`:root { zoom: ${scale} !important; }`,{cssOrigin:'user'});
      if(inserted!==reset)await webContents.removeInsertedCSS(reset).catch(()=>{});
      if(!alive()||ticket!==epoch){if(inserted&&!webContents.isDestroyed())await webContents.removeInsertedCSS(inserted).catch(()=>{});return;}
      key=inserted;state={...state,scale,tooSmall:wantedMode==='fit'&&ratio<.35,pending:false};notify();
    }).catch(()=>{if(ticket===epoch&&alive()){state={...state,pending:false,error:'viewport-unavailable'};notify();}});
    return queue.then(()=>({...state}));
  }
  return {
    setBounds(next){bounds={width:next.width,height:next.height};return refresh();},
    setMode(next){if(!['fit','actual'].includes(next))throw Error('Unknown viewport mode');mode=next;return refresh();},
    refresh,
    snapshot:()=>({...state}),
    dispose(){disposed=true;epoch++;const old=key;key=null;if(old&&!webContents.isDestroyed())void webContents.removeInsertedCSS(old).catch(()=>{});}
  };
}
module.exports={viewportScale,createViewportController,MEASURE_VIEWPORT};

