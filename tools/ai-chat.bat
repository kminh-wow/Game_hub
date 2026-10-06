@echo off
chcp 65001 >nul
rem AI 대사용 Qwen 켜기: 내 PC에서 llama-server 를 띄우고, 게임 서버로 SSH 터널을 연다.
rem 이 창을 닫으면 터널이 끊겨서 AI 는 미리 써 둔 대사로 돌아간다. (Qwen 창도 같이 닫아 주세요)

set "MODEL=%USERPROFILE%\qwen3-1.7b-f16.gguf"
set "LLAMA=%USERPROFILE%\llama-bin-vk\llama-server.exe"
set "KEY=%USERPROFILE%\.ssh\word-chain-ec2"
set "SERVER=ubuntu@52.200.153.207"
set "PORT=18080"

if not exist "%MODEL%" ( echo 모델 파일이 없어요: %MODEL% & pause & exit /b 1 )
if not exist "%LLAMA%" ( echo llama-server 가 없어요: %LLAMA% & pause & exit /b 1 )

echo Qwen 을 켜는 중...
start "Qwen (llama-server)" /min "%LLAMA%" -m "%MODEL%" --host 127.0.0.1 --port %PORT% -c 4096 -ngl 99 --jinja

:loop
echo 게임 서버에 연결합니다. 연결되면 AI 대사를 Qwen 이 만들어요. (끄려면 이 창을 닫으세요)
ssh -i "%KEY%" -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -R 127.0.0.1:%PORT%:127.0.0.1:%PORT% %SERVER%
echo 연결이 끊겼어요. 5초 뒤 다시 연결합니다.
timeout /t 5 /nobreak >nul
goto loop
