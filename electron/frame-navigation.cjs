// A subframe's HTTPS recovery must not use WebContents.loadURL (main frame).
async function navigateOriginalFrame(contents,event,targetUrl,legacy={}) {
 const target=new URL(targetUrl);if(target.protocol!=='https:')throw Error('https_required');
 if(contents.isDestroyed())throw Error('workspace_closed');
 const main=event.isMainFrame??legacy.isMainFrame??true;
 if(main){await contents.loadURL(target.href);return 'main';}
 const frame=event.frame||(Number.isInteger(legacy.frameProcessId)&&Number.isInteger(legacy.frameRoutingId)?legacy.resolveFrame?.(legacy.frameProcessId,legacy.frameRoutingId):null);
 if(!frame||frame.isDestroyed())throw Error('frame_not_available');
 await frame.executeJavaScript(`location.replace(${JSON.stringify(target.href)});true`);
 return 'subframe';
}
module.exports={navigateOriginalFrame};
