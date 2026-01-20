"""
Supertonic Video Generator
자막 영상 합성 (CPU 인코딩 전용)
"""
import os
import datetime
import numpy as np
import soundfile as sf
from PIL import Image as PILImage, ImageDraw, ImageFont

from .utils import (
    OUTPUT_DIR, TEMP_DIR, FONTS_DIR,
    hex_to_rgb, get_font_path, setup_imagemagick
)
from .tts import get_tts_engine
from .subtitle import get_subtitle_generator

# Pillow 호환성 패치
if not hasattr(PILImage, 'ANTIALIAS'):
    PILImage.ANTIALIAS = PILImage.LANCZOS

# ImageMagick 설정
setup_imagemagick()


class VideoGenerator:
    """CPU 전용 영상 생성기"""

    def __init__(self):
        self.tts_engine = get_tts_engine()
        self.subtitle_gen = get_subtitle_generator()

    def _create_subtitle_image(self, text: str, font, outline_width: int = 3) -> tuple:
        """자막 이미지 생성 (캐싱용)"""
        bbox = font.getbbox(text)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        bbox_offset_x = bbox[0]
        bbox_offset_y = bbox[1]

        img_width = text_width + outline_width * 2 + 20
        img_height = text_height + outline_width * 2 + 20

        subtitle_img = PILImage.new('RGBA', (img_width, img_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(subtitle_img)

        text_x = (img_width - text_width) // 2 - bbox_offset_x
        text_y = (img_height - text_height) // 2 - bbox_offset_y

        # PIL stroke 기능 사용
        try:
            draw.text((text_x, text_y), text, font=font,
                      fill=(255, 255, 255, 255),
                      stroke_width=outline_width,
                      stroke_fill=(0, 0, 0, 255))
        except TypeError:
            # stroke 미지원 버전 폴백
            for dx, dy in [(-outline_width, 0), (outline_width, 0),
                           (0, -outline_width), (0, outline_width),
                           (-outline_width, -outline_width), (outline_width, -outline_width),
                           (-outline_width, outline_width), (outline_width, outline_width)]:
                draw.text((text_x + dx, text_y + dy), text, font=font, fill=(0, 0, 0, 255))
            draw.text((text_x, text_y), text, font=font, fill=(255, 255, 255, 255))

        return np.array(subtitle_img), img_width, img_height

    def _calculate_subtitle_position(self, position: str, video_width: int, video_height: int,
                                      img_width: int, img_height: int,
                                      offset_x_pct: float, offset_y_pct: float) -> tuple:
        """자막 위치 계산"""
        margin = 50
        offset_x_px = int(video_width * offset_x_pct / 100)
        offset_y_px = int(video_height * offset_y_pct / 100)

        if position == '중앙':
            clip_x = (video_width - img_width) // 2
            clip_y = (video_height - img_height) // 2
        elif position == '하단-중앙':
            clip_x = (video_width - img_width) // 2
            clip_y = video_height - img_height - margin
        elif position == '상단-중앙':
            clip_x = (video_width - img_width) // 2
            clip_y = margin
        else:
            clip_x = (video_width - img_width) // 2
            clip_y = video_height - img_height - margin

        return clip_x + offset_x_px, clip_y + offset_y_px

    def create_video(self, tts_text: str, subtitle_text: str,
                     voice_name: str, language: str, speed: float, quality: int,
                     background_path: str, resolution: str,
                     font_size: int, subtitle_position: str,
                     offset_x: float, offset_y: float,
                     use_shape: bool, shape_x1: float, shape_y1: float,
                     shape_x2: float, shape_y2: float,
                     shape_color: str, shape_opacity: float,
                     output_name: str = None, progress_callback=None) -> tuple:
        """영상 생성 메인 함수"""
        from moviepy.editor import (
            ImageClip, VideoFileClip, AudioFileClip,
            CompositeVideoClip, ColorClip
        )

        if not tts_text or not tts_text.strip():
            return None, "TTS 텍스트를 입력해주세요."

        if not subtitle_text or not subtitle_text.strip():
            subtitle_text = tts_text

        # 기본값 처리
        font_size = max(10, min(200, int(font_size) if font_size else 70))
        resolution = resolution or "1920x1080"
        shape_x1 = max(-10, min(110, float(shape_x1) if shape_x1 is not None else 0))
        shape_y1 = max(-10, min(110, float(shape_y1) if shape_y1 is not None else 0))
        shape_x2 = max(-10, min(110, float(shape_x2) if shape_x2 is not None else 100))
        shape_y2 = max(-10, min(110, float(shape_y2) if shape_y2 is not None else 100))
        shape_opacity = max(0.0, min(1.0, float(shape_opacity) if shape_opacity is not None else 0.5))
        offset_x = max(-50, min(50, float(offset_x) if offset_x is not None else 0))
        offset_y = max(-50, min(50, float(offset_y) if offset_y is not None else 0))

        shape_rgb = hex_to_rgb(shape_color)
        video_width, video_height = map(int, resolution.split('x'))

        try:
            if progress_callback:
                progress_callback(5, "준비 중...")

            # 배경 타입 확인
            background_type = None
            if background_path:
                ext = os.path.splitext(background_path)[1].lower()
                if ext in ['.mp4', '.avi', '.mov', '.mkv', '.webm']:
                    background_type = 'video'
                else:
                    background_type = 'image'

            # 음성 생성
            if progress_callback:
                progress_callback(10, "TTS 모델 로드 중...")

            audio_array, audio_duration = self.tts_engine.synthesize_to_array(
                tts_text, language, voice_name, speed, quality, progress_callback
            )

            if audio_array is None:
                return None, "음성 생성 실패"

            if progress_callback:
                progress_callback(40, "오디오 파일 저장 중...")

            temp_audio_path = os.path.join(TEMP_DIR, "temp_video_audio.wav")
            sf.write(temp_audio_path, audio_array, self.tts_engine.sample_rate)

            # 자막 타이밍 생성
            subtitle_timings = self.subtitle_gen.generate_timings(
                audio_array, self.tts_engine.sample_rate,
                subtitle_text, language, progress_callback
            )

            # 배경 클립 생성
            if progress_callback:
                progress_callback(55, "배경 영상 준비 중...")

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
                bg_clip = ColorClip(
                    size=(video_width, video_height),
                    color=(26, 26, 46)
                ).set_duration(audio_duration)

            # 도형 클립 생성
            shape_clip = None
            if use_shape and shape_x1 != shape_x2 and shape_y1 != shape_y2:
                px_x1 = int(video_width * min(shape_x1, shape_x2) / 100)
                px_y1 = int(video_height * min(shape_y1, shape_y2) / 100)
                px_x2 = int(video_width * max(shape_x1, shape_x2) / 100)
                px_y2 = int(video_height * max(shape_y1, shape_y2) / 100)

                shape_w = px_x2 - px_x1
                shape_h = px_y2 - px_y1

                if shape_w > 0 and shape_h > 0:
                    shape_clip = ColorClip(
                        size=(shape_w, shape_h),
                        color=shape_rgb
                    ).set_opacity(shape_opacity)
                    shape_clip = shape_clip.set_duration(audio_duration)
                    shape_clip = shape_clip.set_position((px_x1, px_y1))

            # 자막 클립 생성
            if progress_callback:
                progress_callback(60, "자막 클립 생성 중...")

            pil_font = get_font_path(font_size)
            subtitle_clips = []
            subtitle_image_cache = {}

            for i, timing in enumerate(subtitle_timings):
                line = timing['text']
                start_time = timing['start']
                end_time = timing['end']

                if not line:
                    continue

                if i % 50 == 0 and progress_callback:
                    prog = 60 + int((i / len(subtitle_timings)) * 15)
                    progress_callback(prog, f'자막 클립 [{i + 1}/{len(subtitle_timings)}]')

                try:
                    # 캐싱된 자막 이미지 사용
                    if line not in subtitle_image_cache:
                        subtitle_image_cache[line] = self._create_subtitle_image(line, pil_font)

                    img_array, img_width, img_height = subtitle_image_cache[line]

                    txt_clip = ImageClip(img_array, ismask=False, transparent=True)
                    txt_clip = txt_clip.set_duration(end_time - start_time)

                    clip_x, clip_y = self._calculate_subtitle_position(
                        subtitle_position, video_width, video_height,
                        img_width, img_height, offset_x, offset_y
                    )

                    txt_clip = txt_clip.set_position((clip_x, clip_y))
                    txt_clip = txt_clip.set_start(start_time).set_end(end_time)
                    subtitle_clips.append(txt_clip)

                except Exception as e:
                    print(f"자막 클립 생성 실패 [{i}]: {e}")

            if progress_callback:
                progress_callback(75, "영상 합성 중...")

            # 클립 합성
            all_clips = [bg_clip]
            if shape_clip is not None:
                all_clips.append(shape_clip)
            all_clips.extend(subtitle_clips)

            final_clip = CompositeVideoClip(all_clips)

            if progress_callback:
                progress_callback(78, "오디오 추가 중...")

            audio_clip = AudioFileClip(temp_audio_path)
            final_clip = final_clip.set_audio(audio_clip)

            if progress_callback:
                progress_callback(80, "영상 인코딩 중... (CPU)")

            # 출력 파일명
            if output_name:
                filename = f"{output_name}.mp4"
            else:
                timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = f"video_{timestamp}.mp4"

            filepath = os.path.join(OUTPUT_DIR, filename)

            # CPU 인코딩 (libx264 고정)
            final_clip.write_videofile(
                filepath,
                fps=30,
                codec='libx264',  # CPU 인코딩 고정
                audio_codec='aac',
                verbose=True,
                logger='bar'
            )

            # 리소스 정리
            final_clip.close()
            audio_clip.close()
            if background_path and background_type == 'video':
                bg_clip.close()

            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)

            if progress_callback:
                progress_callback(100, "완료!")

            return filepath, f"영상 생성 완료!\n파일: {filename}\n길이: {audio_duration:.1f}초"

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None, f"오류 발생: {str(e)}"

    def create_solid_video(self, hours: int, minutes: int, seconds: int,
                           bg_color: str, resolution: str,
                           show_clock: bool, clock_color: str,
                           progress_callback=None) -> tuple:
        """단색 배경 영상 생성"""
        from moviepy.editor import ColorClip, CompositeVideoClip, ImageClip

        try:
            if progress_callback:
                progress_callback(5, "설정 확인 중...")

            total_seconds = int(hours or 0) * 3600 + int(minutes or 0) * 60 + int(seconds or 0)

            if total_seconds <= 0:
                return None, "1초 이상의 시간을 입력해주세요."

            if total_seconds > 3600 * 48:
                return None, "최대 48시간까지만 생성 가능합니다."

            resolution = resolution or "1920x1080"
            video_width, video_height = map(int, resolution.split('x'))

            bg_rgb = hex_to_rgb(bg_color)
            clock_rgb = hex_to_rgb(clock_color) if clock_color else (255, 255, 255)

            if progress_callback:
                progress_callback(10, "배경 클립 생성 중...")

            bg_clip = ColorClip(
                size=(video_width, video_height),
                color=bg_rgb
            ).set_duration(total_seconds)

            if show_clock:
                if progress_callback:
                    progress_callback(15, "시계 프레임 생성 중...")

                pil_font = get_font_path(120)
                clock_clips = []

                for i in range(total_seconds):
                    if i % 60 == 0 and progress_callback:
                        prog = 15 + int((i / total_seconds) * 70)
                        progress_callback(prog, f"시계 프레임 생성 중... {i}/{total_seconds}초")

                    h = i // 3600
                    m = (i % 3600) // 60
                    s = i % 60
                    time_str = f"{h:02d}:{m:02d}:{s:02d}"

                    img = PILImage.new('RGBA', (video_width, video_height), (0, 0, 0, 0))
                    draw = ImageDraw.Draw(img)

                    bbox = draw.textbbox((0, 0), time_str, font=pil_font)
                    text_width = bbox[2] - bbox[0]
                    text_height = bbox[3] - bbox[1]

                    text_x = (video_width - text_width) // 2
                    text_y = (video_height - text_height) // 2

                    draw.text((text_x, text_y), time_str, font=pil_font, fill=(*clock_rgb, 255))

                    clip = ImageClip(np.array(img), transparent=True).set_duration(1).set_start(i)
                    clock_clips.append(clip)

                if progress_callback:
                    progress_callback(85, "영상 합성 중...")

                final_clip = CompositeVideoClip([bg_clip] + clock_clips)
            else:
                final_clip = bg_clip

            if progress_callback:
                progress_callback(90, "영상 인코딩 중... (CPU)")

            timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"solid_{timestamp}.mp4"
            filepath = os.path.join(OUTPUT_DIR, filename)

            # CPU 인코딩 고정
            final_clip.write_videofile(
                filepath,
                fps=1,
                codec='libx264',
                audio=False,
                verbose=True,
                logger='bar'
            )

            final_clip.close()

            if progress_callback:
                progress_callback(100, "완료!")

            duration_str = f"{hours}시간 {minutes}분 {seconds}초" if hours > 0 else f"{minutes}분 {seconds}초"
            return filepath, f"영상 생성 완료!\n파일: {filename}\n길이: {duration_str}"

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None, f"오류 발생: {str(e)}"

    def generate_preview(self, subtitle_text: str, background_path: str,
                         resolution: str, font_size: int, subtitle_position: str,
                         offset_x: float, offset_y: float,
                         use_shape: bool, shape_x1: float, shape_y1: float,
                         shape_x2: float, shape_y2: float, shape_opacity: float) -> str:
        """자막 미리보기 이미지 생성"""
        try:
            font_size = max(10, min(200, int(font_size) if font_size else 70))
            offset_x = max(-50, min(50, float(offset_x) if offset_x is not None else 0))
            offset_y = max(-50, min(50, float(offset_y) if offset_y is not None else 0))
            shape_x1 = float(shape_x1) if shape_x1 is not None else 0
            shape_y1 = float(shape_y1) if shape_y1 is not None else 0
            shape_x2 = float(shape_x2) if shape_x2 is not None else 100
            shape_y2 = float(shape_y2) if shape_y2 is not None else 100
            shape_opacity = float(shape_opacity) if shape_opacity is not None else 0.5

            resolution = resolution or "1920x1080"
            video_width, video_height = map(int, resolution.split('x'))

            # 배경 이미지
            if background_path and os.path.exists(background_path):
                ext = os.path.splitext(background_path)[1].lower()
                if ext in ['.mp4', '.avi', '.mov', '.mkv', '.webm']:
                    from moviepy.editor import VideoFileClip
                    clip = VideoFileClip(background_path)
                    frame = clip.get_frame(0)
                    clip.close()
                    bg_img = PILImage.fromarray(frame)
                    bg_img = bg_img.resize((video_width, video_height), PILImage.LANCZOS)
                else:
                    bg_img = PILImage.open(background_path)
                    bg_img = bg_img.resize((video_width, video_height), PILImage.LANCZOS)
                bg_img = bg_img.convert('RGBA')
            else:
                bg_img = PILImage.new('RGBA', (video_width, video_height), (26, 26, 46, 255))

            # 자막 텍스트
            if not subtitle_text or not subtitle_text.strip():
                subtitle_text = "자막 미리보기 텍스트"

            first_line = subtitle_text.strip().split('\n')[0]
            pil_font = get_font_path(font_size)

            # 도형 그리기
            if use_shape and shape_x1 != shape_x2 and shape_y1 != shape_y2:
                px_x1 = int(video_width * min(shape_x1, shape_x2) / 100)
                px_y1 = int(video_height * min(shape_y1, shape_y2) / 100)
                px_x2 = int(video_width * max(shape_x1, shape_x2) / 100)
                px_y2 = int(video_height * max(shape_y1, shape_y2) / 100)

                overlay = PILImage.new('RGBA', bg_img.size, (0, 0, 0, 0))
                overlay_draw = ImageDraw.Draw(overlay)
                alpha = int(255 * shape_opacity)
                overlay_draw.rectangle([px_x1, px_y1, px_x2, px_y2], fill=(0, 0, 0, alpha))
                bg_img = PILImage.alpha_composite(bg_img.convert('RGBA'), overlay)

            # 자막 그리기
            img_array, img_width, img_height = self._create_subtitle_image(first_line, pil_font)
            subtitle_img = PILImage.fromarray(img_array)

            clip_x, clip_y = self._calculate_subtitle_position(
                subtitle_position, video_width, video_height,
                img_width, img_height, offset_x, offset_y
            )

            bg_img.paste(subtitle_img, (clip_x, clip_y), subtitle_img)

            # 미리보기 저장
            preview_path = os.path.join(TEMP_DIR, "preview.png")
            bg_img.convert('RGB').save(preview_path)

            return preview_path

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None


# 싱글톤 인스턴스
_video_generator = None

def get_video_generator() -> VideoGenerator:
    global _video_generator
    if _video_generator is None:
        _video_generator = VideoGenerator()
    return _video_generator
