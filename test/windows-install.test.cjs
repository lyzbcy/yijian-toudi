const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.WINDOWS_INSTALL_SOURCE_ROOT||path.resolve(__dirname,'..'),p=JSON.parse(fs.readFileSync(path.join(root,'package.json'))),n=p.build.nsis||{},file=path.join(root,'installer/windows-options.nsh'),s=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'',main=fs.readFileSync(path.join(root,'electron/main.cjs'),'utf8');
for(const [name,fn]of [
 ['assisted wizard, no forced one-click',()=>assert.equal(n.oneClick,false)],
 ['per-user, no elevation',()=>{assert.equal(n.perMachine,false);assert.equal(n.allowElevation,false);}],
 ['user installation path choice',()=>assert.equal(n.allowToChangeInstallationDirectory,true)],
 ['desktop not unconditionally created',()=>assert.equal(n.createDesktopShortcut,false)],
 ['start-menu always available',()=>assert.equal(n.createStartMenuShortcut,true)],
 ['user data retained on uninstall',()=>assert.equal(n.deleteAppDataOnUninstall,false)],
 ['finish page optional run enabled',()=>assert.equal(n.runAfterFinish,true)],
 ['finish and force-run launch installed executable, not shell link lookup',()=>assert.match(s,/StrCpy \$launchLink "\$appExe"/)],
 ['custom options script wired',()=>assert.equal(n.include,'installer/windows-options.nsh')],
 ['public uninstall inventory contains installation location',()=>assert.match(s,/WriteRegStr HKCU "\$\{UNINSTALL_REGISTRY_KEY\}" InstallLocation "\$INSTDIR"/)],
 ['desktop page checkbox and user decision',()=>{assert.match(s,/Page custom YjtDesktopPage YjtDesktopPageLeave/);assert.match(s,/NSD_CreateCheckbox/);assert.match(s,/NSD_GetState/);}],
 ['first-use desktop unchecked and prior choice restored',()=>{assert.match(s,/StrCpy \$YjtDesktopChoice 0/);assert.match(s,/ReadRegDWORD.*DesktopShortcut/);}],
 ['explicit silent desktop zero/one parsing',()=>{assert.match(s,/GetOptions.*\/DESKTOP=/);assert.match(s,/\$R1 == "0"/);assert.match(s,/\$R1 == "1"/);}],
 ['desktop link uses actual exe and stable identity',()=>{assert.match(s,/CreateShortCut "\$newDesktopLink" "\$appExe"/);assert.match(s,/SetLnkAUMI.*APP_ID/);}],
 ['uninstall respects keep-shortcuts and ownership flag',()=>{assert.match(s,/customUnInstall/);assert.match(s,/IfNot.*isKeepShortcuts/);assert.match(s,/ReadRegDWORD.*DesktopShortcut/);}],
 ['no custom recursive deletion or appdata mutation',()=>{assert.ok(s);assert.doesNotMatch(s,/RMDir|DeleteRegKey|SetShellVarContext all|RequestExecutionLevel admin/);}],
 ['Windows app matches stable build appID',()=>assert.ok(main.includes("app.setAppUserModelId('"+p.build.appId+"')"))]
])test(name,fn);
