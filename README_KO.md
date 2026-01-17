# Supertonic TTS - 한국어 가이드

고품질 한국어 음성 합성(TTS) 및 자막 영상 생성 웹 앱입니다.

## 주요 기능

- **음성 합성 (TTS)**: 텍스트를 자연스러운 음성으로 변환
- **다국어 지원**: 한국어, 영어, 스페인어, 포르투갈어, 프랑스어
- **영상 생성**: 배경 이미지/영상에 자막과 음성을 합성한 영상 제작
- **자막 타이밍**: Whisper AI를 활용한 자동 자막 타이밍 생성
- **커스터마이징**: 음성 스타일, 속도, 자막 위치/크기/배경 설정 가능

## 웹 앱 설치 및 실행

### 필수 패키지

```bash
pip install onnxruntime soundfile python-docx openai-whisper gradio moviepy==1.0.3
```

### 시스템 요구사항

- Python 3.8+
- ImageMagick (영상 생성 시 필요)
- 한글 폰트 (Noto Sans KR 또는 나눔고딕)

### 로컬 실행

```bash
cd web_app
python app.py
```

브라우저에서 `http://localhost:7860` 접속

### Kaggle에서 실행

```python
# 파일 복사 및 패키지 설치
!cp -r /kaggle/input/supertonic/* /kaggle/working/
!pip install -q onnxruntime soundfile python-docx openai-whisper gradio moviepy==1.0.3
!apt-get install -y fonts-nanum imagemagick > /dev/null 2>&1

# 앱 실행
!python /kaggle/working/web_app/app.py
```

## 웹 앱 파일 구조

```
web_app/
├── app.py              # Gradio 웹 앱 (메인)
└── app_streamlit.py    # Streamlit 버전 (대체)
```

## 음성 스타일

| 코드 | 설명 |
|------|------|
| F1, F2 | 여성 음성 |
| M1, M2 | 남성 음성 |

## 영상 설정

| 설정 | 설명 | 기본값 |
|------|------|--------|
| 해상도 | 영상 크기 | 1920x1080 |
| 폰트 크기 | 자막 크기 | 70 |
| 자막 위치 | 화면 내 위치 | 중앙 |
| 자막 배경 | 반투명 배경 사용 | 사용 |
| 배경 투명도 | 배경 불투명도 | 0.6 |

## 사용 방법

1. **대본 입력**: 텍스트 직접 입력 또는 TXT/DOCX 파일 업로드
2. **자막 입력** (선택): 별도 자막 텍스트 입력 (비워두면 대본 사용)
3. **배경 업로드** (선택): 이미지 또는 영상 파일 업로드
4. **설정 조정**: 음성, 속도, 언어, 영상 설정 조정
5. **생성하기**: 버튼 클릭하여 음성/영상 생성

## 라이선스

이 프로젝트는 Supertone Inc.의 TTS 모델을 사용합니다.
자세한 내용은 [영문 README](README.md)를 참조하세요.
