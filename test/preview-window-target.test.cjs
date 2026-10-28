const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
test('compiled Windows preview selector ignores helper/wrong process windows and preserves ambiguity/modal guards',()=>{
 assert.ok(fs.readFileSync(path.resolve(__dirname,'../zeen-tools/preview-window.ps1')).subarray(0,3).equals(Buffer.from([239,187,191])),'Windows PowerShell 5 requires UTF8 BOM for these Chinese titles');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yjt-native-selector-SAMPLE-'));
 const script=path.join(dir,'test.ps1'),helper=path.resolve(__dirname,'../zeen-tools/preview-window.ps1').replaceAll("'","''");
 fs.writeFileSync(script,'\uFEFF'+`$ErrorActionPreference='Stop'; . '${helper}'
 function Item($pidValue,$handle,$title,$className='Chrome_WidgetWin_1',$visible=$true,$enabled=$true,$owner=0){$i=New-Object YjtPreviewNativeWindow+Item;$i.pid=$pidValue;$i.handle=$handle;$i.title=$title;$i.className=$className;$i.visible=$visible;$i.enabled=$enabled;$i.owner=$owner;return $i}
 $name='一键投递 · LOCAL PREVIEW';$good=Item 123 22 $name;$blank=Item 123 11 ''
 if([YjtPreviewNativeWindow]::Select(@($blank,$good),123,$true)-ne 22){throw 'blank helper selected'}
 if([YjtPreviewNativeWindow]::Select(@((Item 124 33 $name),$good),123,$true)-ne 22){throw 'other PID selected'}
 foreach($bad in @((Item 123 33 ($name+' OTHER')),(Item 123 33 $name 'OtherClass'),(Item 123 33 $name 'Chrome_WidgetWin_1' $true $true 99))){if([YjtPreviewNativeWindow]::Select(@($bad),123,$false)-ne 0){throw 'foreign/owned/title candidate selected'}}
 if([YjtPreviewNativeWindow]::Select(@((Item 123 44 ($name+' · AI DEBUG'))),123,$true)-ne 44){throw 'AI title rejected'}
 $caught=$false;try{[YjtPreviewNativeWindow]::Select(@($good,(Item 123 33 $name)),123,$true)|Out-Null}catch{$caught=$true};if(!$caught){throw 'ambiguity silently accepted'}
 $hidden=Item 123 55 $name 'Chrome_WidgetWin_1' $false;if([YjtPreviewNativeWindow]::Select(@($hidden),123,$true)-ne 0 -or [YjtPreviewNativeWindow]::Select(@($hidden),123,$false)-ne 55){throw 'hidden readiness/close mixed'}
 if([YjtPreviewNativeWindow]::Select(@((Item 123 66 $name 'Chrome_WidgetWin_1' $true $false)),123,$false)-ne 0){throw 'disabled modal bypassed'}
 Write-Output 'PREVIEW_WINDOW_SELECTOR 9/9; WM_CLOSE_SENT=0'
 `);
 const r=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PREVIEW_WINDOW_SELECTOR 9\/9; WM_CLOSE_SENT=0/);
});
