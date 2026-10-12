!include LogicLib.nsh
!include x64.nsh

!ifndef BUILD_UNINSTALLER
Var /GLOBAL xiangmaoLegacy32Checked
Var /GLOBAL xiangmaoLegacyUninstallPath

Function XiangmaoExtractQuotedPath
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R1 ""
  StrCpy $R2 0
  StrCpy $R3 $R0 1
  StrCmp $R3 "$\"" 0 XiangmaoExtractQuotedPathDone
  IntOp $R2 $R2 + 1
  XiangmaoExtractQuotedPathLoop:
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "$\"" XiangmaoExtractQuotedPathDone
    StrCmp $R3 "" XiangmaoExtractQuotedPathDone
    StrCpy $R1 "$R1$R3"
    IntOp $R2 $R2 + 1
    Goto XiangmaoExtractQuotedPathLoop
  XiangmaoExtractQuotedPathDone:
  StrCpy $xiangmaoLegacyUninstallPath $R1
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!endif

!macro XiangmaoAbortLegacy32 MESSAGE
  SetRegView 64
  MessageBox MB_OK|MB_ICONSTOP "${MESSAGE}"
  SetErrorLevel 2
  Quit
!macroend

!macro XiangmaoUninstallLegacy32Root ROOT_KEY MODE TAG
  ClearErrors
  ReadRegStr $R0 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${If} $R0 != ""
    ReadRegStr $R1 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "Publisher"
    ReadRegStr $R2 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "DisplayName"
    ReadRegStr $R3 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    StrCpy $R9 $R2 4
    ; Historical publisher string identifies only installers created before the author metadata update.
    ${If} $R1 != "hale & hael"
    ${OrIf} $R9 != "耀创工坊"
    ${OrIf} $R3 == ""
      !insertmacro XiangmaoAbortLegacy32 "检测到无法安全确认身份的 32 位旧版记录，安装已停止。旧版路径：$R3"
    ${EndIf}
    Push $R0
    Call XiangmaoExtractQuotedPath
    ${If} $xiangmaoLegacyUninstallPath == ""
    ${OrIfNot} ${FileExists} "$xiangmaoLegacyUninstallPath"
    ${OrIfNot} ${FileExists} "$R3\耀创工坊.exe"
      !insertmacro XiangmaoAbortLegacy32 "检测到 32 位旧版，但卸载程序或主程序身份校验失败，安装已停止。旧版路径：$R3"
    ${EndIf}

    Delete "$PLUGINSDIR\xiangmao-old-32-${TAG}.exe"
    ClearErrors
    CopyFiles /SILENT "$xiangmaoLegacyUninstallPath" "$PLUGINSDIR\xiangmao-old-32-${TAG}.exe"
    IfErrors XiangmaoLegacy32CopyFailed_${TAG} XiangmaoLegacy32Copied_${TAG}
    XiangmaoLegacy32CopyFailed_${TAG}:
      !insertmacro XiangmaoAbortLegacy32 "无法准备 32 位旧版卸载程序，安装已停止。旧版路径：$R3"
    XiangmaoLegacy32Copied_${TAG}:
    ClearErrors
    ExecWait '"$PLUGINSDIR\xiangmao-old-32-${TAG}.exe" /S /KEEP_APP_DATA --updated ${MODE} _?=$R3' $R6
    IfErrors XiangmaoLegacy32LaunchFailed_${TAG} XiangmaoLegacy32Result_${TAG}
    XiangmaoLegacy32LaunchFailed_${TAG}:
      !insertmacro XiangmaoAbortLegacy32 "无法启动 32 位旧版卸载程序，安装已停止。旧版路径：$R3"
    XiangmaoLegacy32Result_${TAG}:
    ${If} $R6 != 0
      !insertmacro XiangmaoAbortLegacy32 "32 位旧版卸载失败（错误码 $R6），安装已停止。旧版路径：$R3"
    ${EndIf}
    ReadRegStr $R7 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
    ${If} $R7 != ""
      !insertmacro XiangmaoAbortLegacy32 "32 位旧版卸载后仍有有效记录，安装已停止，避免生成第二个副本。旧版路径：$R3"
    ${EndIf}
  ${EndIf}
!macroend

!macro XiangmaoCleanupLegacy32 CONTEXT_TAG
  ${If} ${RunningX64}
    SetRegView 32
    !insertmacro XiangmaoUninstallLegacy32Root HKEY_CURRENT_USER "/currentuser" ${CONTEXT_TAG}CurrentUser
    !insertmacro XiangmaoUninstallLegacy32Root HKEY_LOCAL_MACHINE "/allusers" ${CONTEXT_TAG}AllUsers
    SetRegView 64
  ${EndIf}
!macroend

!macro XiangmaoValidateUninstallResult TAG ROOT_KEY
  IfErrors XiangmaoUninstallLaunchFailed_${TAG} XiangmaoUninstallResult_${TAG}
  XiangmaoUninstallLaunchFailed_${TAG}:
    ReadRegStr $R8 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    MessageBox MB_OK|MB_ICONSTOP "无法启动已安装的旧版卸载程序，安装已停止。旧版路径：$R8"
    SetErrorLevel 2
    Quit
  XiangmaoUninstallResult_${TAG}:
  ${If} $R0 != 0
    ReadRegStr $R8 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    MessageBox MB_OK|MB_ICONSTOP "旧版卸载失败（错误码 $R0），安装已停止，未创建第二个安装副本。旧版路径：$R8"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro XiangmaoValidateUninstallResult ShellContext SHELL_CONTEXT
  ${If} $xiangmaoLegacy32Checked != "true"
    StrCpy $xiangmaoLegacy32Checked "true"
    !insertmacro XiangmaoCleanupLegacy32 ShellContext
  ${EndIf}
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro XiangmaoValidateUninstallResult CurrentUser HKEY_CURRENT_USER
  ${If} $xiangmaoLegacy32Checked != "true"
    StrCpy $xiangmaoLegacy32Checked "true"
    !insertmacro XiangmaoCleanupLegacy32 CurrentUser
  ${EndIf}
!macroend

!macro customInstall
  CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  ClearErrors
  WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
