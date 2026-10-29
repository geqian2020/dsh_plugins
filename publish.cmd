@echo off
setlocal
cd /d D:\antigravity_veido\book-companion

set "GITROOT=C:\Users\xiale\AppData\Local\Programs\WorkBuddy\resources\vendor\PortableGit"
if not exist "%GITROOT%\cmd\git.exe" (
  echo [ERROR] git.exe not found at %GITROOT%
  echo Install Git for Windows, or edit GITROOT in this file.
  pause
  exit /b 1
)
set "PATH=%GITROOT%\cmd;%GITROOT%\mingw64\bin;%PATH%"
set "GIT=%GITROOT%\cmd\git.exe"

if /i "%~1"=="--check" (
  "%GIT%" --version
  "%GIT%" remote -v
  "%GIT%" log --oneline -3
  exit /b 0
)

echo [1/3] check remote
"%GIT%" remote get-url origin
if errorlevel 1 goto fail

echo [2/3] push ^(a browser login window may open^)
"%GIT%" push -u origin main
if errorlevel 1 goto fail

echo [3/3] done
"%GIT%" log --oneline -3
pause
exit /b 0

:fail
echo.
echo Push failed. Common causes:
echo   1. Login window closed - run this script again
echo   2. Cannot reach github.com - check proxy / VPN
echo   3. Credential Manager blocked - try Git Bash instead
echo.
pause
exit /b 1
