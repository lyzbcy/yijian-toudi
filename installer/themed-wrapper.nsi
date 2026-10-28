Unicode true
!include "FileFunc.nsh"
!ifndef VERSION
!error "VERSION required"
!endif
Name "一键投递"
OutFile "${OUT}\yijian-toudi-setup-${VERSION}.exe"
Icon "${ROOT}\build\icon.ico"
RequestExecutionLevel user
SilentInstall normal
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "一键投递"
VIAddVersionKey "FileDescription" "一键投递安装程序"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "捞鱼工作室"
Function .onInit
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=backend.exe "${OUT}\yijian-toudi-backend-${VERSION}.exe"
 File "${ROOT}\installer\installer-ui.ps1"
 File "${ROOT}\installer\icon.png"
 File "${ROOT}\installer\mascot.png"
 IfSilent silent interactive
 silent:
  ${GetParameters} $R0
  ExecWait '$\"$PLUGINSDIR\backend.exe$\" $R0' $R1
  SetErrorLevel $R1
  Goto done
 interactive:
  ExecWait '$\"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe$\" -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File $\"$PLUGINSDIR\installer-ui.ps1$\" -InstallerPath $\"$PLUGINSDIR\backend.exe$\" -Version $\"${VERSION}$\" -PayloadBytes ${PAYLOAD_BYTES}' $R1
  SetErrorLevel $R1
 done:
 Quit
FunctionEnd
Section
SectionEnd
