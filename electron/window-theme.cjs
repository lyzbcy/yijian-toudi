const WINDOWS_CHROME_HEIGHT=36;
function windowTheme(platform=process.platform){
 if(platform==='win32')return{titleBarStyle:'hidden',titleBarOverlay:{color:'#f6f7fb',symbolColor:'#27334b',height:WINDOWS_CHROME_HEIGHT},backgroundColor:'#f6f7fb'};
 if(platform==='darwin')return{titleBarStyle:'hiddenInset',trafficLightPosition:{x:18,y:18},backgroundColor:'#f6f7fb'};
 return{backgroundColor:'#f6f7fb'};
}
module.exports={windowTheme,WINDOWS_CHROME_HEIGHT};
