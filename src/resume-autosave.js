(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ResumeAutosave=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function create({capture,save,onState=()=>{},onSaved=()=>{},delay=650,setTimer=setTimeout,clearTimer=clearTimeout}){
  let version=0,saved=0,timer=null,running=null,error=null;
  const notify=status=>onState({status,pending:version!==saved,error:error?.message||''});
  const schedule=()=>{if(timer)clearTimer(timer);timer=setTimer(()=>{timer=null;flush().catch(()=>{});},delay);};
  async function flush(){
   if(timer){clearTimer(timer);timer=null;}
   if(running){await running;if(version!==saved)return flush();return;}
   if(version===saved)return;
   const v=version;error=null;notify('saving');
   running=(async()=>{try{const snapshot=capture();const result=await save(snapshot);saved=v;await onSaved(result,{clean:version===saved});notify(version===saved?'saved':'dirty');}catch(e){error=e;notify('failed');throw e;}})();
   try{await running;}finally{running=null;}
   if(version!==saved&&!error)return flush();
  }
  return {mark(){version++;error=null;notify('dirty');schedule();},flush,pending:()=>version!==saved,busy:()=>!!running,
   reset(){if(running)throw Error('保存进行中');if(timer)clearTimer(timer);timer=null;version=saved=0;error=null;notify('saved');},
   status:()=>({pending:version!==saved,busy:!!running,error:error?.message||''})};
 }
 return {create};
});
