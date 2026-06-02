; ==============================================================================
; Omnecor HMCI — NSIS Custom Installer Header
; ==============================================================================
; Included by electron-builder's NSIS target via electron-builder.yml:
;   nsis:
;     include: ../../windows/omnecor.nsh
;
; This file adds Omnecor-specific install/uninstall actions on top of
; the default electron-builder NSIS scaffold.
; ==============================================================================

; --- Install: download and run Ollama silently ---
Section "Install Ollama (Local AI Engine)" SecOllama
  SetDetailsPrint textonly
  DetailPrint "Checking for Ollama..."

  ; Check if Ollama is already installed
  IfFileExists "$PROGRAMFILES64\Ollama\ollama.exe" OllamaExists OllamaInstall

  OllamaInstall:
    DetailPrint "Downloading Ollama installer..."
    NSISdl::download "https://ollama.com/download/OllamaSetup.exe" "$TEMP\OllamaSetup.exe"
    Pop $R0
    StrCmp $R0 "success" OllamaInstallRun
      MessageBox MB_ICONEXCLAMATION "Could not download Ollama. Install manually from https://ollama.com"
      Goto OllamaExists

    OllamaInstallRun:
      DetailPrint "Installing Ollama (silent)..."
      ExecWait '"$TEMP\OllamaSetup.exe" /S' $R1
      Delete "$TEMP\OllamaSetup.exe"
      DetailPrint "Ollama installation complete."

  OllamaExists:
    DetailPrint "Ollama ready."
SectionEnd

; --- Install: Node.js check ---
Section "-NodeJS Check" SecNodeJS
  SetDetailsPrint textonly

  ; Check Node.js via registry (installed by nvm/official installer)
  ReadRegStr $R0 HKLM "SOFTWARE\Node.js" "InstallPath"
  StrCmp $R0 "" NodeMissing NodeFound

  NodeMissing:
    MessageBox MB_ICONINFORMATION \
      "Node.js was not found on this system.$\n$\nOmnecor requires Node.js 22+.$\nDownload it from https://nodejs.org and re-run the installer." \
      IDOK NodeFound

  NodeFound:
SectionEnd

; --- Install: Write application version to registry ---
Section "-WriteRegistry" SecRegistry
  WriteRegStr HKCU "Software\Omnecor\HMCI" "Version" "2.3.0"
  WriteRegStr HKCU "Software\Omnecor\HMCI" "InstallDir" "$INSTDIR"
SectionEnd

; --- Uninstall: Remove registry entries ---
Section "un.Registry"
  DeleteRegKey HKCU "Software\Omnecor\HMCI"
SectionEnd
