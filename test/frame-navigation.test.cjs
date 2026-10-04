const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.FIXTURE_SOURCE_ROOT||path.resolve(__dirname,'..');
test('HTTPS recovery navigates only the original frame, never guesses parent',async()=>{
 const {navigateOriginalFrame}=require(path.join(root,'electron/frame-navigation.cjs'));let main=0,child=0;const contents={isDestroyed:()=>false,loadURL:async()=>{main++;}};
 const frame={isDestroyed:()=>false,executeJavaScript:async s=>{child++;assert.ok(s.includes('location.replace'));assert.ok(s.includes('?state=fixture'));}};
 await navigateOriginalFrame(contents,{isMainFrame:false,frame},'https://campus.jd.com/return?state=fixture');assert.equal(main,0);assert.equal(child,1);
 await navigateOriginalFrame(contents,{},'https://campus.jd.com/return?state=fixture',{isMainFrame:false,frameProcessId:1,frameRoutingId:2,resolveFrame:()=>frame});assert.equal(main,0);assert.equal(child,2);
 await assert.rejects(navigateOriginalFrame(contents,{isMainFrame:false,frame:null},'https://campus.jd.com/return'),/frame_not_available/);assert.equal(main,0);
 await assert.rejects(navigateOriginalFrame(contents,{isMainFrame:false,frame:{isDestroyed:()=>true}},'https://campus.jd.com/return'),/frame_not_available/);
 await navigateOriginalFrame(contents,{isMainFrame:true},'https://campus.jd.com/return');assert.equal(main,1);
 await assert.rejects(navigateOriginalFrame(contents,{isMainFrame:true},'http://campus.jd.com/return'),/https_required/);
});
