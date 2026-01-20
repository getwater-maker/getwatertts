# Supertonic TTS Desktop App

## 프로젝트 개요

Supertonic TTS 기반 음성 합성 및 자막 영상 생성 데스크톱 앱.
기존 Gradio 웹 UI를 Eel 기반 로컬 데스크톱 앱으로 교체.
GPU 없는 환경에서 CPU 전용으로 구동.

## 기술 스택

- **Python**: 3.10
- **UI**: Eel (Chrome/Edge 기반 데스크톱 UI)
- **TTS**: ONNX Runtime (CPU 전용)
- **자막**: OpenAI Whisper (CPU 모드)
- **영상**: MoviePy + FFmpeg (libx264)
- **문서**: python-docx (DOCX 파일 처리)

## 프로젝트 구조

```
supertonic/
├── main.py                    # Eel 앱 진입점
├── requirements_eel.txt       # CPU 전용 의존성
├── core/                      # 백엔드 로직
│   ├── __init__.py           # Lazy imports
│   ├── tts.py                # TTS 엔진 (ONNX, CPU)
│   ├── subtitle.py           # Whisper 자막 생성 (CPU)
│   ├── video.py              # 영상 합성 (libx264)
│   └── utils.py              # 파일 처리, 유틸리티
├── eel_web/                   # 프론트엔드
│   ├── index.html            # 메인 UI
│   ├── css/style.css         # 다크 테마 스타일
│   └── js/app.js             # Eel 연동 JavaScript
├── assets/                    # 모델 및 리소스
│   ├── onnx/                 # TTS ONNX 모델
│   └── voice_styles/         # 음성 스타일 JSON
├── outputs/                   # 생성된 파일 출력
└── temp/                      # 임시 파일
```

## 주요 기능

### TTS 음성 합성
- **지원 언어**: 한국어(ko), English(en), Español(es), Português(pt), Français(fr)
- **음성 스타일**: F1, F2 (여성), M1, M2 (남성)
- **속도 조절**: 0.5x ~ 2.0x
- **품질 설정**: 1 ~ 10 (높을수록 고품질)

### 자막 영상 생성
- Whisper 기반 자동 타임코드 생성
- 배경 이미지/영상 지원
- 자막 위치/폰트 크기 조절
- 반투명 도형 오버레이

### 파일 지원
- TXT/DOCX 대본 파일 업로드
- MP4/AVI/MOV 영상 배경
- PNG/JPG 이미지 배경

## 코딩 규칙

### 네이밍
- 함수/변수: `snake_case`
- 클래스: `PascalCase`
- 상수: `UPPER_SNAKE_CASE`

### 주석
- 한국어로 작성
- 함수/클래스에 docstring 필수

### 파일 구조
- 모듈당 하나의 책임
- 싱글톤 패턴으로 엔진 인스턴스 관리 (`get_*_engine()` 함수)

## 금지 사항

### 절대 사용 금지
- `torch.cuda`, `cuda`, `CUDAExecutionProvider` 등 GPU 관련 코드
- `device="cuda"` 설정
- `h264_nvenc` 등 GPU 인코딩
- Gradio 라이브러리

### CPU 전용 설정
```python
# Whisper - CPU 강제
whisper.load_model("base", device="cpu")

# ONNX Runtime - CPU만 사용
providers = ["CPUExecutionProvider"]

# FFmpeg - CPU 인코딩
codec='libx264'  # NVENC 사용 안함
```

## 실행 방법

```bash
# 의존성 설치
pip install -r requirements_eel.txt

# 앱 실행
python main.py
```

## Eel 함수 목록

### Python → JavaScript (exposed)
- `get_voices()`: 음성 목록 반환
- `synthesize_audio()`: 음성 합성
- `create_video()`: 영상 생성
- `create_solid_video()`: 단색 배경 영상
- `generate_preview()`: 미리보기 이미지
- `open_output_folder()`: 출력 폴더 열기

### JavaScript → Python (eel.expose)
- `updateProgress(percent, message)`: 진행률 업데이트
- `updateSolidProgress(percent, message)`: 단색 영상 진행률

## UI 테마

다크 테마 색상:
- 배경: `#0d0d1a` (메인), `#1a1a2e` (세컨더리)
- 카드: `#16213e`
- 강조: `#4e54c8` → `#8f94fb` (그라데이션)
- 텍스트: `#e0e0e0`
