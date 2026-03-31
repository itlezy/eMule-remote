@echo off
setlocal
rem Starts the built remote sidecar and web UI, building first if needed.

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"
set "ENTRY_POINT=%REPO_ROOT%\dist\server\index.js"

pushd "%REPO_ROOT%" >nul

if not exist "%ENTRY_POINT%" (
    call npm run build
    if errorlevel 1 (
        set "EXIT_CODE=%ERRORLEVEL%"
        popd >nul
        exit /b %EXIT_CODE%
    )
)

call npm run start
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

exit /b %EXIT_CODE%
