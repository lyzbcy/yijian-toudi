'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
test('Actual Windows PowerShell preserves a null backup path and atomically replaces existing helper result', {skip:process.platform!=='win32'},()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-atomic-helper-'));
 try{
  const file=path.join(directory,'中文结果.json'),source=fs.readFileSync(path.join(__dirname,'../electron/install-update.ps1'),'utf8');
  const fn=source.split(/\r?\n/).find(line=>line.startsWith('function WriteJson('));assert(fn);
  const script=`$ErrorActionPreference='Stop';${fn}\n$file='${file.replaceAll("'","''")}';WriteJson $file @{status='installed';nonce='sample'};$temp=$file+'.historical';[IO.File]::WriteAllText($temp,'{}');$historicalRejected=$false;try{[IO.File]::Replace($temp,$file,$null)}catch{$historicalRejected=$true};if(!$historicalRejected){throw 'Expected v42 null-to-empty-string regression'};[IO.File]::Delete($temp);WriteJson $file @{status='failed';nonce='sample';restored=$true};`;
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{status:'failed',nonce:'sample',restored:true});
  assert.deepEqual(fs.readdirSync(directory),['中文结果.json']);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
