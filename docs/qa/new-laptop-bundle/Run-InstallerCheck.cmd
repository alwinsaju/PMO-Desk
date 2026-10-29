@echo off
rem Runs the AI OS installer check with an execution policy that cannot block it.
rem   Run-InstallerCheck.cmd -Installer "D:\AI OS Setup 2.0.0.exe"
rem Run it from a NORMAL (not "as administrator") window.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-InstallerCheck.ps1" %*
exit /b %ERRORLEVEL%
