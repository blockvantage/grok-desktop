; electron-builder derives one-click APP_FILENAME from package.json `name`.
; This workspace package is scoped (`@grokdesk/desktop`), which otherwise
; installs under %LOCALAPPDATA%\Programs\@grokdeskdesktop. Keep the package
; scope for pnpm while giving end users the product-named install directory.
!undef APP_FILENAME
!define APP_FILENAME "Grok Desk"
