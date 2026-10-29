@echo off
chcp 65001 >nul
cd /d D:\antigravity_veido\book-companion

echo [1/3] 配置远端
git remote remove origin >nul 2>&1
git remote add origin https://github.com/geqian2020/dsh_plugins.git

echo [2/3] 推送（会弹出 GitHub 登录窗口）
git push -f -u origin main
if errorlevel 1 goto fail

echo [3/3] 完成
git log --oneline -3
goto end

:fail
echo.
echo 推送失败。常见原因：
echo   1. 浏览器登录窗口被关掉 —— 重新运行本脚本
echo   2. 网络到 github.com 不通 —— 挂代理后重试
echo   3. 远端有你不想要的提交 —— 本脚本已用 -f 覆盖 main

:end
echo.
pause
