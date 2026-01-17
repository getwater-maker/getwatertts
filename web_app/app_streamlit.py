import os
import platform

# ImageMagick 설정 (플랫폼별 자동 감지)
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
            break
else:
    os.environ['IMAGEMAGICK_BINARY'] = '/usr/bin/convert'

import streamlit as st
import sys
import datetime
import numpy as np
import re
import tempfile

# 상위 폴더의 py 모듈 사용을 위해 경로 추가
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'py'))

from helper import load_text_to_speech, load_voice_style, chunk_text  # type: ignore
import soundfile as sf
from docx import Document

# 전역 변수
ASSETS_DIR = os.path.join(os.path.dirname(__file__), '..', 'assets')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'outputs')
TEMP_DIR = os.path.join(os.path.dirname(__file__), 'temp')

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)


@st.cache_resource
def load_tts_model(use_gpu=False):
    """TTS 모델 로드 (캐시)"""
    onnx_dir = os.path.join(ASSETS_DIR, 'onnx')
    model = load_text_to_speech(onnx_dir, use_gpu=use_gpu)
    return model


@st.cache_resource
def load_whisper_model():
    """Whisper 모델 로드 (캐시)"""
    import whisper  # type: ignore
    return whisper.load_model("base")


def get_voice_list():
    """사용 가능한 음성 목록"""
    voice_dir = os.path.join(ASSETS_DIR, 'voice_styles')
    voices = []
    if os.path.exists(voice_dir):
        for f in sorted(os.listdir(voice_dir)):
            if f.endswith('.json'):
                name = f.replace('.json', '')
                label = f"여성 {name[1]}" if name.startswith('F') else f"남성 {name[1]}"
                voices.append(f"{label} ({name})")
    return voices


def get_voice_file(voice_label):
    """음성 라벨에서 파일명 추출"""
    match = re.search(r'\(([^)]+)\)', voice_label)
    return f"{match.group(1)}.json" if match else "F1.json"


def read_text_file(uploaded_file):
    """TXT 또는 DOCX 파일 읽기"""
    if uploaded_file is None:
        return ""

    ext = os.path.splitext(uploaded_file.name)[1].lower()

    try:
        if ext == '.txt':
            return uploaded_file.read().decode('utf-8')
        elif ext == '.docx':
            # 임시 파일로 저장 후 읽기
            temp_path = os.path.join(TEMP_DIR, uploaded_file.name)
            with open(temp_path, 'wb') as f:
                f.write(uploaded_file.read())
            doc = Document(temp_path)
            text = '\n'.join([para.text for para in doc.paragraphs if para.text.strip()])
            os.remove(temp_path)
            return text
        else:
            return f"지원하지 않는 파일 형식: {ext}"
    except Exception as e:
        return f"파일 읽기 오류: {str(e)}"


def get_max_length(lang):
    """언어별 최대 청크 길이"""
    return 120 if lang == "ko" else 300


def analyze_audio_with_whisper(audio_path, language='ko'):
    """Whisper로 오디오 분석"""
    model = load_whisper_model()
    lang_map = {'ko': 'ko', 'en': 'en', 'es': 'es', 'pt': 'pt', 'fr': 'fr'}
    whisper_lang = lang_map.get(language, 'ko')
    result = model.transcribe(audio_path, language=whisper_lang, word_timestamps=True, verbose=False)
    return result


def match_subtitles_to_audio(whisper_result, subtitle_lines, audio_duration):
    """자막 타임코드 생성"""
    subtitle_timings = []
    segments = whisper_result.get('segments', [])

    if not subtitle_lines:
        return subtitle_timings

    total_lines = len(subtitle_lines)

    if segments:
        speech_start = segments[0]['start']
        speech_end = segments[-1]['end']
        speech_duration = speech_end - speech_start

        line_lengths = [len(line) for line in subtitle_lines]
        total_chars = sum(line_lengths)

        current_time = speech_start
        for i, line in enumerate(subtitle_lines):
            char_ratio = line_lengths[i] / total_chars if total_chars > 0 else 1 / total_lines
            line_duration = max(0.5, speech_duration * char_ratio)

            start_time = current_time
            end_time = min(current_time + line_duration, audio_duration)

            subtitle_timings.append({'text': line, 'start': start_time, 'end': end_time})
            current_time = end_time
    else:
        time_per_line = audio_duration / total_lines
        for i, line in enumerate(subtitle_lines):
            subtitle_timings.append({
                'text': line,
                'start': i * time_per_line,
                'end': (i + 1) * time_per_line
            })

    if subtitle_timings:
        subtitle_timings[-1]['end'] = audio_duration

    return subtitle_timings


def synthesize_speech(text, voice_label, language, speed, total_step, progress_callback=None):
    """음성 합성"""
    if not text or not text.strip():
        return None, "텍스트를 입력해주세요."

    try:
        if progress_callback:
            progress_callback(0.1, "TTS 모델 로드 중...")

        tts = load_tts_model()
        voice_file = get_voice_file(voice_label)
        voice_path = os.path.join(ASSETS_DIR, 'voice_styles', voice_file)
        style = load_voice_style([voice_path], verbose=False)

        max_len = get_max_length(language)
        chunks = chunk_text(text, max_len=max_len)
        total_chunks = len(chunks) if chunks else 1

        all_audio = []
        total_duration = 0.0

        for i, chunk in enumerate(chunks):
            if not chunk.strip():
                continue

            if progress_callback:
                progress_callback(0.2 + (i / total_chunks) * 0.6, f"음성 생성 중 [{i+1}/{total_chunks}]")

            wav, duration = tts(chunk, language, style, int(total_step), float(speed))
            w = wav[0, :int(tts.sample_rate * duration[0].item())]
            all_audio.append(w)
            total_duration += duration[0].item()

            if i < total_chunks - 1:
                silence = np.zeros(int(0.3 * tts.sample_rate), dtype=np.float32)
                all_audio.append(silence)
                total_duration += 0.3

        if progress_callback:
            progress_callback(0.9, "파일 저장 중...")

        combined = np.concatenate(all_audio) if len(all_audio) > 1 else (all_audio[0] if all_audio else np.array([], dtype=np.float32))

        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"tts_{timestamp}.wav"
        filepath = os.path.join(OUTPUT_DIR, filename)
        sf.write(filepath, combined, tts.sample_rate)

        return filepath, f"음성 생성 완료! 길이: {total_duration:.1f}초"

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None, f"오류 발생: {str(e)}"


def create_video(tts_text, subtitle_text, voice_label, language, speed, total_step,
                 background_path, resolution, font_size, subtitle_position,
                 use_subtitle_bg, subtitle_bg_opacity, subtitle_bg_padding,
                 progress_callback=None):
    """영상 생성"""
    if not tts_text or not tts_text.strip():
        return None, "TTS 텍스트를 입력해주세요."

    if not subtitle_text or not subtitle_text.strip():
        subtitle_text = tts_text

    try:
        from moviepy.editor import (
            ImageClip, VideoFileClip, AudioFileClip,
            CompositeVideoClip, TextClip, ColorClip
        )

        if progress_callback:
            progress_callback(0.05, "준비 중...")

        video_width, video_height = map(int, resolution.split('x'))
        voice_file = get_voice_file(voice_label)

        # 배경 파일 타입
        background_type = None
        if background_path:
            ext = os.path.splitext(background_path)[1].lower()
            background_type = 'video' if ext in ['.mp4', '.avi', '.mov', '.mkv', '.webm'] else 'image'

        # 음성 생성
        if progress_callback:
            progress_callback(0.1, "TTS 모델 로드 중...")

        tts = load_tts_model()
        voice_path = os.path.join(ASSETS_DIR, 'voice_styles', voice_file)
        style = load_voice_style([voice_path], verbose=False)

        max_len = get_max_length(language)
        chunks = chunk_text(tts_text, max_len=max_len) or [tts_text]
        total_chunks = len(chunks)

        all_audio = []
        audio_duration = 0.0

        for i, chunk in enumerate(chunks):
            if not chunk.strip():
                continue

            if progress_callback:
                progress_callback(0.15 + (i / total_chunks) * 0.25, f"음성 [{i+1}/{total_chunks}]")

            wav, duration = tts(chunk, language, style, int(total_step), float(speed))
            w = wav[0, :int(tts.sample_rate * duration[0].item())]
            all_audio.append(w)
            audio_duration += duration[0].item()

            if i < total_chunks - 1:
                silence = np.zeros(int(0.3 * tts.sample_rate), dtype=np.float32)
                all_audio.append(silence)
                audio_duration += 0.3

        combined_audio = np.concatenate(all_audio) if len(all_audio) > 1 else (all_audio[0] if all_audio else np.array([], dtype=np.float32))

        if progress_callback:
            progress_callback(0.4, "오디오 저장 중...")

        temp_audio_path = os.path.join(TEMP_DIR, "temp_audio.wav")
        sf.write(temp_audio_path, combined_audio, tts.sample_rate)

        # Whisper 분석
        subtitle_lines = [line.strip() for line in subtitle_text.split('\n') if line.strip()]

        if subtitle_lines:
            if progress_callback:
                progress_callback(0.45, "Whisper 분석 중...")
            try:
                whisper_result = analyze_audio_with_whisper(temp_audio_path, language)
                subtitle_timings = match_subtitles_to_audio(whisper_result, subtitle_lines, audio_duration)
            except Exception as e:
                print(f"Whisper 분석 실패: {e}")
                time_per_line = audio_duration / len(subtitle_lines)
                subtitle_timings = [
                    {'text': line, 'start': i * time_per_line, 'end': (i + 1) * time_per_line}
                    for i, line in enumerate(subtitle_lines)
                ]
        else:
            subtitle_timings = []

        # 배경 클립
        if progress_callback:
            progress_callback(0.55, "배경 준비 중...")

        if background_path and background_type == 'video':
            bg_clip = VideoFileClip(background_path)
            if bg_clip.duration < audio_duration:
                bg_clip = bg_clip.loop(duration=audio_duration)
            else:
                bg_clip = bg_clip.subclip(0, audio_duration)
            bg_clip = bg_clip.resize((video_width, video_height))
        elif background_path and background_type == 'image':
            bg_clip = ImageClip(background_path).set_duration(audio_duration)
            bg_clip = bg_clip.resize((video_width, video_height))
        else:
            bg_clip = ColorClip(size=(video_width, video_height), color=(26, 26, 46)).set_duration(audio_duration)

        # 자막 위치
        def get_subtitle_pos(pos, width, height, fsize):
            margin = 50
            positions = {
                '상단-중앙': ('center', margin),
                '중앙': ('center', 'center'),
                '하단-중앙': ('center', height - margin - fsize),
            }
            return positions.get(pos, ('center', height - margin - fsize))

        txt_position = get_subtitle_pos(subtitle_position, video_width, video_height, font_size)

        # 자막 클립 생성
        if progress_callback:
            progress_callback(0.6, "자막 생성 중...")

        subtitle_clips = []

        # 폰트 찾기
        font_candidates = [
            '/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf',
            '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
            '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf',
            'C:/Windows/Fonts/NotoSansKR-Bold.ttf',
            'C:/Windows/Fonts/malgunbd.ttf',
            'C:/Windows/Fonts/malgun.ttf',
        ]

        selected_font = None
        for font_path in font_candidates:
            if os.path.exists(font_path):
                selected_font = font_path
                break

        for i, timing in enumerate(subtitle_timings):
            line = timing['text']
            start_time = timing['start']
            end_time = timing['end']

            if not line:
                continue

            try:
                txt_clip = TextClip(
                    line,
                    fontsize=font_size,
                    color='white',
                    font=selected_font,
                    stroke_color='black',
                    stroke_width=2,
                    method='caption',
                    size=(video_width - 100, None)
                )

                # 자막 배경 박스
                if use_subtitle_bg:
                    txt_w, txt_h = txt_clip.size
                    bg_w = video_width + 10
                    bg_h = txt_h + int(subtitle_bg_padding * 2)

                    bg_box = ColorClip(size=(bg_w, bg_h), color=(0, 0, 0)).set_opacity(subtitle_bg_opacity)
                    bg_box = bg_box.set_duration(end_time - start_time)

                    bg_x = -5
                    if txt_position[1] == 'center':
                        bg_y = (video_height - bg_h) // 2
                    else:
                        txt_y = txt_position[1] if isinstance(txt_position[1], int) else 0
                        bg_y = txt_y - int(subtitle_bg_padding)

                    bg_box = bg_box.set_position((bg_x, bg_y))
                    bg_box = bg_box.set_start(start_time).set_end(end_time)
                    subtitle_clips.append(bg_box)

                txt_clip = txt_clip.set_position(txt_position)
                txt_clip = txt_clip.set_start(start_time).set_end(end_time)
                subtitle_clips.append(txt_clip)
            except Exception as e:
                print(f"자막 클립 생성 실패: {e}")

        if progress_callback:
            progress_callback(0.75, "영상 합성 중...")

        final_clip = CompositeVideoClip([bg_clip] + subtitle_clips)
        audio_clip = AudioFileClip(temp_audio_path)
        final_clip = final_clip.set_audio(audio_clip)

        if progress_callback:
            progress_callback(0.8, "영상 인코딩 중...")

        timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"video_{timestamp}.mp4"
        filepath = os.path.join(OUTPUT_DIR, filename)

        final_clip.write_videofile(filepath, fps=30, codec='libx264', audio_codec='aac', verbose=False, logger=None)

        # 정리
        final_clip.close()
        audio_clip.close()
        if background_path and background_type == 'video':
            bg_clip.close()

        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)

        return filepath, f"영상 생성 완료! 길이: {audio_duration:.1f}초"

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None, f"오류 발생: {str(e)}"


def generate_preview(subtitle_text, background_path, resolution, font_size, subtitle_position,
                     use_subtitle_bg, subtitle_bg_opacity, subtitle_bg_padding):
    """미리보기 이미지 생성"""
    try:
        from PIL import Image, ImageDraw, ImageFont

        font_size = int(font_size) if font_size and font_size >= 30 else 70
        subtitle_bg_opacity = float(subtitle_bg_opacity) if subtitle_bg_opacity else 0.6
        subtitle_bg_padding = int(subtitle_bg_padding) if subtitle_bg_padding else 20
        resolution = resolution if resolution else "1920x1080"

        video_width, video_height = map(int, resolution.split('x'))

        # 배경
        if background_path:
            ext = os.path.splitext(background_path)[1].lower()
            if ext in ['.mp4', '.avi', '.mov', '.mkv', '.webm']:
                from moviepy.editor import VideoFileClip
                clip = VideoFileClip(background_path)
                frame = clip.get_frame(0)
                clip.close()
                bg_img = Image.fromarray(frame)
                bg_img = bg_img.resize((video_width, video_height), Image.LANCZOS)
            else:
                bg_img = Image.open(background_path)
                bg_img = bg_img.resize((video_width, video_height), Image.LANCZOS)
                bg_img = bg_img.convert('RGBA')
        else:
            bg_img = Image.new('RGBA', (video_width, video_height), (26, 26, 46, 255))

        # 자막 텍스트
        if not subtitle_text or not subtitle_text.strip():
            subtitle_text = "자막 미리보기"

        first_line = subtitle_text.strip().split('\n')[0]

        # 폰트
        font_candidates = [
            '/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf',
            'C:/Windows/Fonts/NotoSansKR-Bold.ttf',
            'C:/Windows/Fonts/malgunbd.ttf',
            'C:/Windows/Fonts/malgun.ttf',
        ]

        selected_font = None
        for font_path in font_candidates:
            if os.path.exists(font_path):
                selected_font = font_path
                break

        try:
            font = ImageFont.truetype(selected_font, font_size) if selected_font else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()

        draw = ImageDraw.Draw(bg_img)
        bbox = draw.textbbox((0, 0), first_line, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        # 위치
        margin = 50
        positions = {
            '상단-중앙': ((video_width - text_width) // 2, margin),
            '중앙': ((video_width - text_width) // 2, (video_height - text_height) // 2),
            '하단-중앙': ((video_width - text_width) // 2, video_height - text_height - margin),
        }
        text_x, text_y = positions.get(subtitle_position, positions['하단-중앙'])

        # 배경 박스
        if use_subtitle_bg:
            padding = int(subtitle_bg_padding)
            bg_h = text_height + padding * 2
            bg_x1 = -5
            bg_x2 = video_width + 5
            bg_y1 = text_y - padding
            bg_y2 = bg_y1 + bg_h

            overlay = Image.new('RGBA', bg_img.size, (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            alpha = int(255 * subtitle_bg_opacity)
            overlay_draw.rectangle([bg_x1, bg_y1, bg_x2, bg_y2], fill=(0, 0, 0, alpha))
            bg_img = Image.alpha_composite(bg_img.convert('RGBA'), overlay)

        # 텍스트 그리기
        draw = ImageDraw.Draw(bg_img)
        outline_width = 2
        for dx in range(-outline_width, outline_width + 1):
            for dy in range(-outline_width, outline_width + 1):
                if dx != 0 or dy != 0:
                    draw.text((text_x + dx, text_y + dy), first_line, font=font, fill=(0, 0, 0, 255))
        draw.text((text_x, text_y), first_line, font=font, fill=(255, 255, 255, 255))

        return bg_img.convert('RGB')

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None


# ========== Streamlit UI ==========

st.set_page_config(page_title="Supertonic TTS", page_icon="🎙️", layout="wide")

st.title("🎙️ Supertonic TTS")

# 사이드바: 설정
with st.sidebar:
    st.header("⚙️ 설정")

    voices = get_voice_list()
    if not voices:
        voices = ["음성 파일 없음"]

    voice = st.selectbox("음성", voices)
    language = st.selectbox("언어", ["한국어", "English", "Español", "Português", "Français"])
    speed = st.slider("속도", 0.5, 2.0, 1.0, 0.1)
    quality = st.slider("품질", 1, 10, 5, 1)

    st.divider()
    st.header("🎬 영상 설정")

    resolution = st.selectbox("해상도", ["1920x1080", "1280x720", "3840x2160", "1080x1920", "720x1280"])
    font_size = st.slider("폰트 크기", 30, 120, 70, 5)
    subtitle_position = st.selectbox("자막 위치", ["하단-중앙", "상단-중앙", "중앙"])

    use_subtitle_bg = st.checkbox("자막 배경", value=True)
    if use_subtitle_bg:
        subtitle_bg_opacity = st.slider("배경 투명도", 0.1, 1.0, 0.6, 0.1)
        subtitle_bg_padding = st.slider("배경 여백", 5, 50, 20, 5)
    else:
        subtitle_bg_opacity = 0.6
        subtitle_bg_padding = 20

# 메인 영역
col1, col2 = st.columns([1, 1])

with col1:
    st.subheader("📝 텍스트 입력")

    # 파일 업로드
    text_file = st.file_uploader("텍스트/DOCX 파일", type=['txt', 'docx'], key="text_file")

    if text_file:
        loaded_text = read_text_file(text_file)
        tts_text = st.text_area("텍스트 (음성 변환용)", value=loaded_text, height=200)
    else:
        tts_text = st.text_area("텍스트 (음성 변환용)", placeholder="음성으로 변환할 텍스트를 입력하세요...", height=200)

    # 자막 파일 업로드
    subtitle_file = st.file_uploader("자막 파일 (선택)", type=['txt', 'docx'], key="subtitle_file")

    if subtitle_file:
        loaded_subtitle = read_text_file(subtitle_file)
        subtitle_text = st.text_area("자막 (비워두면 위 텍스트 사용)", value=loaded_subtitle, height=150)
    else:
        subtitle_text = st.text_area("자막 (비워두면 위 텍스트 사용)", placeholder="화면에 표시될 자막...", height=150)

with col2:
    st.subheader("🖼️ 배경")

    background_file = st.file_uploader("배경 이미지/영상 (첨부하면 영상 생성)", type=['jpg', 'jpeg', 'png', 'gif', 'mp4', 'avi', 'mov', 'mkv', 'webm'])

    # 배경 파일이 있으면 미리보기 표시
    if background_file:
        # 임시 파일로 저장
        temp_bg_path = os.path.join(TEMP_DIR, f"temp_bg_{background_file.name}")
        with open(temp_bg_path, 'wb') as f:
            f.write(background_file.read())

        st.subheader("👁️ 미리보기")
        preview_text = subtitle_text if subtitle_text.strip() else tts_text
        preview_img = generate_preview(
            preview_text, temp_bg_path, resolution, font_size, subtitle_position,
            use_subtitle_bg, subtitle_bg_opacity, subtitle_bg_padding
        )
        if preview_img:
            st.image(preview_img, use_container_width=True)
    else:
        temp_bg_path = None
        st.info("💡 배경 파일을 첨부하면 영상이 생성됩니다.\n배경 없이 생성하면 음성만 생성됩니다.")

st.divider()

# 생성 버튼
col_btn1, col_btn2, col_btn3 = st.columns([1, 2, 1])
with col_btn2:
    if background_file:
        generate_button = st.button("🎬 영상 생성", type="primary", use_container_width=True)
    else:
        generate_button = st.button("🎙️ 음성 생성", type="primary", use_container_width=True)

# 결과 영역
if generate_button:
    if not tts_text or not tts_text.strip():
        st.error("텍스트를 입력해주세요.")
    else:
        lang_map = {"한국어": "ko", "English": "en", "Español": "es", "Português": "pt", "Français": "fr"}
        lang_code = lang_map.get(language, "ko")

        progress_bar = st.progress(0)
        status_text = st.empty()

        def update_progress(value, text):
            progress_bar.progress(value)
            status_text.text(text)

        if background_file and temp_bg_path:
            # 영상 생성
            filepath, status = create_video(
                tts_text, subtitle_text, voice, lang_code, speed, quality,
                temp_bg_path, resolution, font_size, subtitle_position,
                use_subtitle_bg, subtitle_bg_opacity, subtitle_bg_padding,
                update_progress
            )

            progress_bar.progress(1.0)

            if filepath:
                st.success(f"✅ {status}")
                st.video(filepath)

                with open(filepath, 'rb') as f:
                    st.download_button(
                        label="📥 영상 다운로드",
                        data=f,
                        file_name=os.path.basename(filepath),
                        mime="video/mp4"
                    )
            else:
                st.error(f"❌ {status}")
        else:
            # 음성만 생성
            filepath, status = synthesize_speech(
                tts_text, voice, lang_code, speed, quality,
                update_progress
            )

            progress_bar.progress(1.0)

            if filepath:
                st.success(f"✅ {status}")
                st.audio(filepath)

                with open(filepath, 'rb') as f:
                    st.download_button(
                        label="📥 음성 다운로드",
                        data=f,
                        file_name=os.path.basename(filepath),
                        mime="audio/wav"
                    )
            else:
                st.error(f"❌ {status}")

# Footer
st.divider()
st.caption("Supertonic TTS - Streamlit 버전")
