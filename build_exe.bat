@echo off
chcp 65001 >nul
echo ============================================
echo Supertonic TTS - EXE 빌드
echo ============================================
echo.

:: PyInstaller 설치 확인
pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo PyInstaller 설치 중...
    pip install pyinstaller
)

echo.
echo 빌드 시작...
echo 이 작업은 몇 분 정도 소요됩니다.
echo.

:: 빌드 실행
pyinstaller --clean supertonic.spec

if errorlevel 1 (
    echo.
    echo [오류] 빌드에 실패했습니다.
    pause
    exit /b 1
)

echo.
echo ============================================
echo 빌드 완료!
echo ============================================
echo.
echo 실행 파일 위치: dist\Supertonic\Supertonic.exe
echo.
echo 배포 시 dist\Supertonic 폴더 전체를 복사하세요.
echo ============================================
pause
