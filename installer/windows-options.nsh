!include "nsDialogs.nsh"
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER
Var YjtDesktopChoice
Var YjtDesktopWasOwned
Var YjtDesktopCheckbox
Var YjtOptionsDialog

!macro customInit
  StrCpy $YjtDesktopChoice 0
  StrCpy $YjtDesktopWasOwned 0
  ClearErrors
  ReadRegDWORD $YjtDesktopWasOwned HKCU "${INSTALL_REGISTRY_KEY}" DesktopShortcut
  ${IfNot} ${Errors}
    StrCpy $YjtDesktopChoice $YjtDesktopWasOwned
  ${Else}
    # Legacy NSIS created the same shortcut without storing this option.
    ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R1 != ""
    ${AndIf} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      StrCpy $YjtDesktopChoice 1
      StrCpy $YjtDesktopWasOwned 1
    ${EndIf}
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/DESKTOP=" $R1
  ${IfNot} ${Errors}
    ${If} $R1 == "0"
      StrCpy $YjtDesktopChoice 0
    ${ElseIf} $R1 == "1"
      StrCpy $YjtDesktopChoice 1
    ${Else}
      SetErrorLevel 2
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom YjtDesktopPage YjtDesktopPageLeave
!macroend

Function YjtDesktopPage
  # Do not consume the builder's pending instFilesPre MUI definition.
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--updated" $R1
  ${IfNot} ${Errors}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "快捷方式选项" "开始菜单入口始终保留；桌面快捷方式由你选择。"
  nsDialogs::Create 1018
  Pop $YjtOptionsDialog
  ${If} $YjtOptionsDialog == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 20u 100% 20u "在桌面创建一键投递快捷方式"
  Pop $YjtDesktopCheckbox
  ${NSD_SetState} $YjtDesktopCheckbox $YjtDesktopChoice
  ${NSD_CreateLabel} 0 55u 100% 45u "安装不会固定任务栏，也不会删除已有简历或登录数据。安装后是否立即打开，可在完成页选择。"
  Pop $R0
  nsDialogs::Show
FunctionEnd

Function YjtDesktopPageLeave
  ${NSD_GetState} $YjtDesktopCheckbox $YjtDesktopChoice
FunctionEnd

!macro customInstall
  # electron-builder stores this only in its private key by default; Windows
  # uninstall inventory and launcher metadata also need the public location.
  WriteRegStr HKCU "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"
  ${If} $YjtDesktopChoice == 1
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${ElseIf} $YjtDesktopWasOwned == 1
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  ${EndIf}
  WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" DesktopShortcut $YjtDesktopChoice
!macroend
!else
!macro customUnInstall
  # The stock no-desktop build skips removal; remove only our recorded option.
  ${IfNot} ${isKeepShortcuts}
    ReadRegDWORD $R0 HKCU "${INSTALL_REGISTRY_KEY}" DesktopShortcut
    ${If} $R0 == 1
      WinShell::UninstShortcut "$oldDesktopLink"
      Delete "$oldDesktopLink"
    ${EndIf}
  ${EndIf}
!macroend
!endif
