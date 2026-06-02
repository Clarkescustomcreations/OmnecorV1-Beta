; ==============================================================================
; Omnecor HMCI — electron-builder NSIS macro hooks
;
; These macros are automatically picked up by electron-builder when placed in
; the buildResources directory (build/). Using macros instead of custom Section
; blocks avoids conflicts with NSIS System.dll when using MultiUser.nsh.
; ==============================================================================

; --- Post-install: write version and install path to registry ---
!macro customInstall
  WriteRegStr HKCU "Software\Omnecor\HMCI" "Version" "2.3.0"
  WriteRegStr HKCU "Software\Omnecor\HMCI" "InstallDir" "$INSTDIR"
!macroend

; --- Pre-uninstall: kill running app so file locks are released ---
!macro customUnInstall
  ; Kill the running app process before deleting files
  nsExec::ExecToLog 'taskkill /F /IM "Omnecor.exe" /T'
  Sleep 1500
  DeleteRegKey HKCU "Software\Omnecor\HMCI"
!macroend
