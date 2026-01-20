"""
Supertonic Utilities
파일 처리, 폰트 관리, 공통 유틸리티
"""
import os
import sys
import re
import platform
from docx import Document

# 프로젝트 경로 설정
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(BASE_DIR, 'assets')
OUTPUT_DIR = os.path.join(BASE_DIR, 'outputs')
TEMP_DIR = os.path.join(BASE_DIR, 'temp')
FONTS_DIR = os.path.join(BASE_DIR, 'web_app', 'fonts')

# 폴더 생성
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(FONTS_DIR, exist_ok=True)

# 지원 언어
AVAILABLE_LANGS = ["ko", "en", "es", "pt", "fr"]
LANG_MAP = {
    "한국어": "ko",
    "English": "en",
    "Español": "es",
    "Português": "pt",
    "Français": "fr"
}


def get_lang_code(lang_name: str) -> str:
    """언어 이름을 코드로 변환"""
    return LANG_MAP.get(lang_name, "ko")


def get_max_length(lang: str) -> int:
    """언어별 최대 청크 길이 반환"""
    return 120 if lang == "ko" else 300


def read_text_file(file_path: str) -> str:
    """TXT 또는 DOCX 파일 읽기"""
    if not file_path or not os.path.exists(file_path):
        return ""

    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == '.txt':
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        elif ext == '.docx':
            doc = Document(file_path)
            return '\n'.join([para.text for para in doc.paragraphs if para.text.strip()])
        else:
            return f"지원하지 않는 파일 형식입니다: {ext}"
    except Exception as e:
        return f"파일 읽기 오류: {str(e)}"


def get_voice_list() -> list:
    """사용 가능한 음성 목록 반환"""
    voice_dir = os.path.join(ASSETS_DIR, 'voice_styles')
    voices = []

    if os.path.exists(voice_dir):
        for f in sorted(os.listdir(voice_dir)):
            if f.endswith('.json'):
                name = f.replace('.json', '')
                label = f"여성 {name[1]}" if name.startswith('F') else f"남성 {name[1]}"
                voices.append({"label": f"{label} ({name})", "value": name})

    return voices


def get_voice_file(voice_value: str) -> str:
    """음성 값에서 파일명 추출"""
    # "F1" -> "F1.json"
    return f"{voice_value}.json"


def hex_to_rgb(hex_color: str) -> tuple:
    """#RRGGBB 형식을 (R, G, B) 튜플로 변환"""
    if not hex_color:
        return (0, 0, 0)

    if isinstance(hex_color, dict):
        hex_color = hex_color.get('hex', '#000000')

    if not isinstance(hex_color, str):
        return (0, 0, 0)

    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join([c*2 for c in hex_color])

    try:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        return (r, g, b)
    except (ValueError, IndexError):
        return (0, 0, 0)


def ensure_korean_font() -> str:
    """한글 폰트가 없으면 설치 - TTF 우선"""
    font_path = os.path.join(FONTS_DIR, 'NotoSansKR-SemiBold.ttf')

    # 이미 폰트가 있으면 스킵
    if os.path.exists(font_path) and os.path.getsize(font_path) > 100000:
        print(f"한글 폰트 확인됨: {font_path}")
        return font_path

    # TTF 시스템 폰트 우선 확인
    ttf_fonts = [
        '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
        '/usr/share/fonts/nanum/NanumGothicBold.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf',
        '/usr/share/fonts/opentype/noto/NotoSansKR-Bold.otf',
        'C:/Windows/Fonts/NotoSansKR-Bold.ttf',
        'C:/Windows/Fonts/malgunbd.ttf',
    ]

    for sys_font in ttf_fonts:
        if os.path.exists(sys_font):
            print(f"시스템 TTF 폰트 발견: {sys_font}")
            return sys_font

    # TTC 폰트 (PIL에서 index 필요)
    ttc_fonts = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Bold.ttc',
    ]

    for sys_font in ttc_fonts:
        if os.path.exists(sys_font):
            print(f"시스템 TTC 폰트 발견: {sys_font}")
            return sys_font

    # 다운로드 시도
    font_urls = [
        "https://raw.githubusercontent.com/nickmass/font-patcher/main/fonts/NotoSansKR-Bold.ttf",
        "https://cdn.jsdelivr.net/gh/nickmass/font-patcher/fonts/NotoSansKR-Bold.ttf",
    ]

    for font_url in font_urls:
        try:
            import urllib.request
            print(f"폰트 다운로드 시도: {font_url}")
            urllib.request.urlretrieve(font_url, font_path)
            if os.path.exists(font_path) and os.path.getsize(font_path) > 100000:
                print(f"한글 폰트 다운로드 완료: {font_path}")
                return font_path
        except Exception as e:
            print(f"다운로드 실패: {e}")
            continue

    print("경고: 한글 폰트를 찾을 수 없습니다!")
    return None


def setup_imagemagick():
    """ImageMagick 설정 (플랫폼별 자동 감지)"""
    if platform.system() == 'Windows':
        imagemagick_paths = [
            r'C:\Program Files\ImageMagick-7.1.2-Q16-HDRI\magick.exe',
            r'C:\Program Files\ImageMagick-7.1.1-Q16-HDRI\magick.exe',
            r'C:\Program Files\ImageMagick-7.1.0-Q16-HDRI\magick.exe',
            r'C:\Program Files\ImageMagick\magick.exe',
            r'C:\Program Files (x86)\ImageMagick\magick.exe',
        ]
        for path in imagemagick_paths:
            if os.path.exists(path):
                os.environ['IMAGEMAGICK_BINARY'] = path
                return path
    else:
        os.environ['IMAGEMAGICK_BINARY'] = '/usr/bin/convert'
        return '/usr/bin/convert'
    return None


def get_font_path(font_size: int = 70):
    """PIL 폰트 객체 반환"""
    from PIL import ImageFont

    font_candidates = [
        os.path.join(FONTS_DIR, 'NotoSansKR-SemiBold.ttf'),
        '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
        '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf',
        'C:/Windows/Fonts/NotoSansKR-Bold.ttf',
        'C:/Windows/Fonts/malgunbd.ttf',
    ]

    ttc_candidates = [
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc',
    ]

    # TTF 먼저 시도
    for font_path in font_candidates:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, font_size)
            except Exception:
                continue

    # TTC 시도
    for font_path in ttc_candidates:
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, font_size, index=1)
            except Exception:
                continue

    # 기본 폰트
    return ImageFont.load_default()
