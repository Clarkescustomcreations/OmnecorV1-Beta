; ==============================================================================
; Omnecor HMCI — NSIS Custom Installer Header
; ==============================================================================

; LogicLib provides ${If}/${EndIf}; FileFunc provides ${DriveSpace}.
; electron-builder normally includes these, but guard them so this header is
; self-contained and safe if included standalone.
!include LogicLib.nsh
!include FileFunc.nsh
!insertmacro DriveSpace

; --- Security: require administrator privileges -------------------------------
; Native modules and the Visual C++ runtime check below need elevated access.
RequestExecutionLevel admin

; --- Install: Validate Node.js version (require 22+) --------------------------
Section "-NodeJS Check" SecNodeCheck
  ClearErrors

  ; First confirm Node.js exists at all.
  nsExec::ExecToStack 'node --version'
  Pop $0
  Pop $1
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Node.js 22+ is required but was not found. Please install Node.js 22+ and rerun this installer."
    Abort
  ${EndIf}

  ; Node.js version check - require 22+
  nsExec::ExecToStack 'node -e "process.exit(parseInt(process.version.slice(1)) >= 22 ? 0 : 1)"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION|MB_OK "Omnecor requires Node.js v22 or later.$\n$\nPlease install Node.js 22+ from https://nodejs.org and try again."
    Abort
  ${EndIf}
SectionEnd

; --- Install: Validate native-module dependencies -----------------------------
Section "-Dependency Check" SecDepCheck
  ClearErrors

  ; Visual C++ 2019/2022 Redistributable check
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${If} $0 != 1
    ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  ${EndIf}
  ${If} $0 != 1
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "Microsoft Visual C++ Redistributable (2019 or later) is required but not detected.$\n$\nWould you like to download it now?" IDNO skip_vcredist
    ExecShell "open" "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    skip_vcredist:
    MessageBox MB_ICONEXCLAMATION|MB_OK "Installation may fail without the Visual C++ Redistributable. Please install it and restart the Omnecor installer."
  ${EndIf}

  ; Python 3.10+ check (required for hardware bridges and AI training)
  nsExec::ExecToStack 'python -c "import sys; exit(0 if sys.version_info >= (3,10) else 1)" 2>nul'
  Pop $0
  ${If} $0 != 0
    nsExec::ExecToStack 'python3 -c "import sys; exit(0 if sys.version_info >= (3,10) else 1)" 2>nul'
    Pop $0
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONINFORMATION|MB_OK "Python 3.10 or later is not detected.$\n$\nOmnecor's hardware bridges (Blender, KiCad, ESP flashing) and AI training features require Python 3.10+.$\n$\nCore chat features will work without Python. Download Python from https://python.org if needed."
  ${EndIf}

  ; Disk space check (2GB minimum)
  ${DriveSpace} "$INSTDIR" "/D=F /S=M" $R0
  ${If} $R0 < 2048  ; 2GB in MB
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "Less than 2GB of disk space available at the installation path.$\n$\nOmnecor requires at least 2GB for installation. AI model files will require additional space.$\n$\nContinue anyway?" IDYES continue_install
    Abort
    continue_install:
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
  WriteRegStr HKCU "Software\Omnecor\HMCI" "Version" "2.4.1"
  WriteRegStr HKCU "Software\Omnecor\HMCI" "InstallDir" "$INSTDIR"
SectionEnd

; --- Uninstall: Remove registry keys ---
Section "un.Registry" SecUnRegistry
  DeleteRegKey HKCU "Software\Omnecor\HMCI"
SectionEnd
