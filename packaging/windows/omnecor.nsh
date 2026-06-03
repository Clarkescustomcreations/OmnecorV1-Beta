; ==============================================================================
; Omnecor HMCI — NSIS Custom Installer Header
; ==============================================================================

; --- Install: Check Node.js version ---
Section "-NodeJS Check" SecNodeCheck
  ClearErrors
  nsExec::ExecToStack 'node --version'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Node.js 22+ is required but was not found. Please install Node.js 22+ and rerun this installer."
    Abort
  ${EndIf}
SectionEnd

; --- Install: Install Ollama if not present ---
Section "Install Ollama" SecOllama
  IfFileExists "$PROGRAMFILES64\Ollama\ollama.exe" OllamaFound OllamaNotFound
  OllamaNotFound:
    DetailPrint "Downloading Ollama..."
    NSISdl::download "https://ollama.com/download/OllamaSetup.exe" "$TEMP\OllamaSetup.exe"
    Pop $0
    ${If} $0 == "success"
      ExecWait '"$TEMP\OllamaSetup.exe" /S'
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "Ollama download failed. You can install it manually from https://ollama.com"
    ${EndIf}
  OllamaFound:
SectionEnd

; --- Install: Write application version to registry ---
Section "-WriteRegistry" SecRegistry
  WriteRegStr HKCU "Software\Omnecor\HMCI" "Version" "2.3.0"
  WriteRegStr HKCU "Software\Omnecor\HMCI" "InstallDir" "$INSTDIR"
SectionEnd

; --- Uninstall: Remove registry keys ---
Section "un.Registry" SecUnRegistry
  DeleteRegKey HKCU "Software\Omnecor\HMCI"
SectionEnd
