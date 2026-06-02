; ==============================================================================
; Omnecor HMCI — NSIS Custom Installer Header
; ==============================================================================

; --- Install: Write application version to registry ---
Section "-WriteRegistry" SecRegistry
  WriteRegStr HKCU "Software\Omnecor\HMCI" "Version" "2.3.0"
  WriteRegStr HKCU "Software\Omnecor\HMCI" "InstallDir" "$INSTDIR"
SectionEnd
