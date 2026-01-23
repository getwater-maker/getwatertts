"""
Supertonic Subtitle Generator
Stable-TS 기반 Forced Alignment 자막 타이밍 생성 (CPU 전용)
"""
import os
import numpy as np
import soundfile as sf

from .utils import TEMP_DIR


class SubtitleGenerator:
    """CPU 전용 Stable-TS Forced Alignment 자막 생성기"""

    def __init__(self):
        self.stable_model = None

    def init_model(self):
        """Stable-TS 모델 초기화 (CPU 강제)"""
        if self.stable_model is not None:
            return

        import stable_whisper
        print("Stable-TS 모델 로드 중... (CPU 모드, small)")

        # CPU 강제 설정 - small 모델 사용 (base보다 정확도 높음)
        self.stable_model = stable_whisper.load_model("small", device="cpu")
        print("Stable-TS 모델 로드 완료! (CPU, small)")

    def transcribe_with_alignment(self, audio_path: str, language: str = 'ko') -> dict:
        """Stable-TS로 오디오 분석하여 단어별 정확한 타임스탬프 추출"""
        self.init_model()

        lang_map = {'ko': 'ko', 'en': 'en', 'es': 'es', 'pt': 'pt', 'fr': 'fr'}
        whisper_lang = lang_map.get(language, 'ko')

        # Stable-TS의 transcribe는 자동으로 정확한 단어별 타임스탬프 생성
        result = self.stable_model.transcribe(
            audio_path,
            language=whisper_lang,
            word_timestamps=True,
            vad=True,  # Voice Activity Detection으로 더 정확한 타이밍
            regroup=True  # 단어 그룹화 개선
        )
        return result

    def align_transcript(self, audio_path: str, transcript: str, language: str = 'ko'):
        """Forced Alignment: 주어진 스크립트와 오디오를 정렬"""
        self.init_model()

        lang_map = {'ko': 'ko', 'en': 'en', 'es': 'es', 'pt': 'pt', 'fr': 'fr'}
        whisper_lang = lang_map.get(language, 'ko')

        print(f"Forced Alignment 시작: 언어={whisper_lang}")

        # Stable-TS의 align 메소드 사용 - 주어진 텍스트에 대해 정확한 타이밍 생성
        result = self.stable_model.align(
            audio_path,
            transcript,
            language=whisper_lang,
            vad=True
        )
        return result

    def _normalize_text(self, text: str) -> str:
        """텍스트 정규화 (비교용)"""
        import re
        # 공백, 구두점 제거하고 소문자로
        text = re.sub(r'[^\w\s]', '', text.lower())
        text = re.sub(r'\s+', '', text)
        return text

    def _extract_words_from_result(self, result) -> list:
        """Stable-TS 결과에서 단어 목록 추출"""
        all_words = []

        # Stable-TS 결과 구조에서 단어 추출
        for segment in result.segments:
            if hasattr(segment, 'words') and segment.words:
                for word in segment.words:
                    w = word.word.strip() if hasattr(word, 'word') else str(word).strip()
                    if w:
                        all_words.append({
                            'word': w,
                            'start': word.start if hasattr(word, 'start') else segment.start,
                            'end': word.end if hasattr(word, 'end') else segment.end
                        })
            else:
                # 단어 정보 없으면 세그먼트 텍스트 사용
                text = segment.text.strip() if hasattr(segment, 'text') else ''
                if text:
                    all_words.append({
                        'word': text,
                        'start': segment.start,
                        'end': segment.end
                    })

        return all_words

    def match_subtitles_with_forced_alignment(self, all_words: list, subtitle_lines: list,
                                               audio_duration: float) -> list:
        """
        Forced Alignment 결과를 자막 라인과 매칭

        Word-Level Grouping 방식:
        - 자막 라인의 글자 수를 기준으로 단어들을 그룹화
        - 누적 글자 수가 자막 라인 글자 수에 도달하면 다음 라인으로
        """
        subtitle_timings = []

        if not subtitle_lines or not all_words:
            # 단어 정보 없으면 균등 분배
            print("단어 정보 없음, 균등 분배 사용")
            time_per_line = audio_duration / len(subtitle_lines) if subtitle_lines else 0
            for i, line in enumerate(subtitle_lines):
                subtitle_timings.append({
                    'text': line,
                    'start': i * time_per_line,
                    'end': (i + 1) * time_per_line
                })
            return subtitle_timings

        total_lines = len(subtitle_lines)
        print(f"자막 줄 수: {total_lines}, 추출된 단어 수: {len(all_words)}")

        # 각 자막 라인의 정규화된 글자 수 계산
        line_char_counts = []
        for line in subtitle_lines:
            norm_line = self._normalize_text(line)
            line_char_counts.append(len(norm_line))

        total_subtitle_chars = sum(line_char_counts)

        # 모든 단어의 정규화된 텍스트와 글자 수
        word_texts = []
        word_char_counts = []
        for w in all_words:
            norm_word = self._normalize_text(w['word'])
            word_texts.append(norm_word)
            word_char_counts.append(len(norm_word))

        total_word_chars = sum(word_char_counts)

        print(f"자막 총 글자 수: {total_subtitle_chars}, 인식된 총 글자 수: {total_word_chars}")

        # Word-Level Grouping: 글자 수 기반으로 단어들을 자막 라인에 매칭
        word_idx = 0
        accumulated_chars = 0

        for line_idx, line in enumerate(subtitle_lines):
            target_chars = line_char_counts[line_idx]

            if target_chars == 0:
                # 빈 라인은 이전 타이밍 사용
                if subtitle_timings:
                    prev = subtitle_timings[-1]
                    subtitle_timings.append({
                        'text': line,
                        'start': prev['end'],
                        'end': prev['end'] + 0.1
                    })
                else:
                    subtitle_timings.append({
                        'text': line,
                        'start': 0,
                        'end': 0.1
                    })
                continue

            # 이 라인에 해당하는 단어들 찾기
            line_start = None
            line_end = None
            chars_for_line = 0

            while word_idx < len(all_words) and chars_for_line < target_chars:
                word = all_words[word_idx]
                word_chars = word_char_counts[word_idx]

                if line_start is None:
                    line_start = word['start']

                line_end = word['end']
                chars_for_line += word_chars
                word_idx += 1

            # 마지막 라인이면 남은 단어 모두 포함
            if line_idx == total_lines - 1:
                while word_idx < len(all_words):
                    word = all_words[word_idx]
                    line_end = word['end']
                    word_idx += 1

            # 시작/끝 시간이 없으면 이전 타이밍 기반으로 설정
            if line_start is None:
                if subtitle_timings:
                    line_start = subtitle_timings[-1]['end']
                else:
                    line_start = 0

            if line_end is None or line_end <= line_start:
                line_end = line_start + 0.5  # 최소 0.5초

            subtitle_timings.append({
                'text': line,
                'start': max(0, line_start),
                'end': min(audio_duration, line_end)
            })

            # 로그 출력 (처음 5개, 마지막 3개)
            if line_idx < 5 or line_idx >= total_lines - 3:
                print(f"[{line_idx+1}/{total_lines}] {line_start:.2f}s-{line_end:.2f}s: {line[:30]}")

        # 겹침 방지 및 순서 보정
        for i in range(1, len(subtitle_timings)):
            if subtitle_timings[i]['start'] < subtitle_timings[i-1]['end']:
                # 겹침 해결: 중간점으로 조정
                mid_point = (subtitle_timings[i-1]['end'] + subtitle_timings[i]['start']) / 2
                subtitle_timings[i-1]['end'] = mid_point
                subtitle_timings[i]['start'] = mid_point

        # 마지막 자막은 오디오 끝까지
        if subtitle_timings:
            subtitle_timings[-1]['end'] = audio_duration

        print(f"Forced Alignment 타임코드 생성 완료: {len(subtitle_timings)}개")
        return subtitle_timings

    def generate_timings(self, audio_array: np.ndarray, sample_rate: int,
                         subtitle_text: str, language: str = 'ko',
                         progress_callback=None) -> list:
        """오디오 배열에서 자막 타이밍 생성 (Forced Alignment 방식)"""
        if progress_callback:
            progress_callback(42, "Stable-TS 모델 로드 중...")

        # 임시 오디오 파일 저장
        temp_audio_path = os.path.join(TEMP_DIR, "temp_whisper_audio.wav")
        sf.write(temp_audio_path, audio_array, sample_rate)

        audio_duration = len(audio_array) / sample_rate
        subtitle_lines = [line.strip() for line in subtitle_text.split('\n') if line.strip()]

        if not subtitle_lines:
            return []

        if progress_callback:
            progress_callback(45, "Forced Alignment 분석 중...")

        try:
            # 전체 자막 텍스트를 합쳐서 Forced Alignment 수행
            full_transcript = '\n'.join(subtitle_lines)

            # Stable-TS로 Forced Alignment
            result = self.align_transcript(temp_audio_path, full_transcript, language)

            if progress_callback:
                progress_callback(50, "단어별 타임코드 추출 중...")

            # 단어 목록 추출
            all_words = self._extract_words_from_result(result)

            if progress_callback:
                progress_callback(55, "자막 라인 매칭 중...")

            # Word-Level Grouping으로 자막 타이밍 생성
            timings = self.match_subtitles_with_forced_alignment(all_words, subtitle_lines, audio_duration)

        except Exception as e:
            print(f"Forced Alignment 실패, transcribe 방식 시도: {e}")

            try:
                # Fallback: transcribe 방식
                if progress_callback:
                    progress_callback(48, "음성 인식 분석 중... (fallback)")

                result = self.transcribe_with_alignment(temp_audio_path, language)
                all_words = self._extract_words_from_result(result)

                if progress_callback:
                    progress_callback(55, "자막 라인 매칭 중...")

                timings = self.match_subtitles_with_forced_alignment(all_words, subtitle_lines, audio_duration)

            except Exception as e2:
                print(f"Transcribe도 실패, 균등 분배 사용: {e2}")
                time_per_line = audio_duration / len(subtitle_lines)
                timings = [
                    {'text': line, 'start': i * time_per_line, 'end': (i + 1) * time_per_line}
                    for i, line in enumerate(subtitle_lines)
                ]

        # 임시 파일 정리
        try:
            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)
        except:
            pass

        return timings

    def generate_timings_from_file(self, audio_path: str, subtitle_text: str,
                                    language: str = 'ko', progress_callback=None) -> list:
        """오디오 파일에서 직접 자막 타이밍 생성 (외부 오디오 파일용)"""
        if progress_callback:
            progress_callback(42, "Stable-TS 모델 로드 중...")

        # 오디오 길이 계산
        import soundfile as sf
        audio_info = sf.info(audio_path)
        audio_duration = audio_info.duration

        subtitle_lines = [line.strip() for line in subtitle_text.split('\n') if line.strip()]

        if not subtitle_lines:
            return []

        if progress_callback:
            progress_callback(45, "Forced Alignment 분석 중...")

        try:
            # 전체 자막 텍스트를 합쳐서 Forced Alignment 수행
            full_transcript = '\n'.join(subtitle_lines)

            # Stable-TS로 Forced Alignment
            result = self.align_transcript(audio_path, full_transcript, language)

            if progress_callback:
                progress_callback(50, "단어별 타임코드 추출 중...")

            # 단어 목록 추출
            all_words = self._extract_words_from_result(result)

            if progress_callback:
                progress_callback(55, "자막 라인 매칭 중...")

            # Word-Level Grouping으로 자막 타이밍 생성
            timings = self.match_subtitles_with_forced_alignment(all_words, subtitle_lines, audio_duration)

        except Exception as e:
            print(f"Forced Alignment 실패, transcribe 방식 시도: {e}")

            try:
                # Fallback: transcribe 방식
                if progress_callback:
                    progress_callback(48, "음성 인식 분석 중... (fallback)")

                result = self.transcribe_with_alignment(audio_path, language)
                all_words = self._extract_words_from_result(result)

                if progress_callback:
                    progress_callback(55, "자막 라인 매칭 중...")

                timings = self.match_subtitles_with_forced_alignment(all_words, subtitle_lines, audio_duration)

            except Exception as e2:
                print(f"Transcribe도 실패, 균등 분배 사용: {e2}")
                time_per_line = audio_duration / len(subtitle_lines)
                timings = [
                    {'text': line, 'start': i * time_per_line, 'end': (i + 1) * time_per_line}
                    for i, line in enumerate(subtitle_lines)
                ]

        return timings


# 싱글톤 인스턴스
_subtitle_generator = None

def get_subtitle_generator() -> SubtitleGenerator:
    global _subtitle_generator
    if _subtitle_generator is None:
        _subtitle_generator = SubtitleGenerator()
    return _subtitle_generator
