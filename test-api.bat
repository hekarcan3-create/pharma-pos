@echo off
REM Test script for Windows - verify POS system API endpoints

echo.
echo ===== Brwlix POS System - API Test =====
echo.
echo Testing API endpoints...
echo.

REM Test if server is running
echo Testing connection to server...
powershell -Command "try { $response = Invoke-RestMethod -Uri 'http://localhost:3000/api/dashboard' -TimeoutSec 3; Write-Host 'SUCCESS: Server is running!' -ForegroundColor Green; Write-Host $response | ConvertTo-Json } catch { Write-Host 'ERROR: Server not responding' -ForegroundColor Red; Write-Host 'Make sure to run: npm start' }"

echo.
echo ===== Test Complete =====
echo.
echo If you see SUCCESS above, the server is working!
echo.
echo Open your browser to: http://localhost:3000
echo.
pause
