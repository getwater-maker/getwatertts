"""
Supertonic TTS Engine
CPU 전용 음성 합성 엔진
"""
import os
import sys
import json
import numpy as np
import onnxruntime as ort
import soundfile as sf
from typing import Optional

# 상위 폴더의 helper 모듈 사용
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'py'))

from .utils import ASSETS_DIR, OUTPUT_DIR, get_max_length, get_voice_file


class Style:
    """음성 스타일 데이터"""
    def __init__(self, style_ttl_onnx: np.ndarray, style_dp_onnx: np.ndarray):
        self.ttl = style_ttl_onnx
        self.dp = style_dp_onnx


class UnicodeProcessor:
    """텍스트 전처리 및 유니코드 인덱싱"""
    AVAILABLE_LANGS = ["en", "ko", "es", "pt", "fr"]

    def __init__(self, unicode_indexer_path: str):
        with open(unicode_indexer_path, "r") as f:
            self.indexer = json.load(f)

    def _preprocess_text(self, text: str, lang: str) -> str:
        import re
        from unicodedata import normalize

        text = normalize("NFKD", text)

        # 이모지 제거
        emoji_pattern = re.compile(
            "[\U0001f600-\U0001f64f"
            "\U0001f300-\U0001f5ff"
            "\U0001f680-\U0001f6ff"
            "\U0001f700-\U0001f77f"
            "\U0001f780-\U0001f7ff"
            "\U0001f800-\U0001f8ff"
            "\U0001f900-\U0001f9ff"
            "\U0001fa00-\U0001fa6f"
            "\U0001fa70-\U0001faff"
            "\u2600-\u26ff"
            "\u2700-\u27bf"
            "\U0001f1e6-\U0001f1ff]+",
            flags=re.UNICODE,
        )
        text = emoji_pattern.sub("", text)

        # 특수문자 치환
        replacements = {
            "–": "-", "‑": "-", "—": "-", "_": " ",
            "\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'",
            "´": "'", "`": "'", "[": " ", "]": " ", "|": " ", "/": " ",
            "#": " ", "→": " ", "←": " ",
        }
        for k, v in replacements.items():
            text = text.replace(k, v)

        text = re.sub(r"[♥☆♡©\\]", "", text)

        expr_replacements = {"@": " at ", "e.g.,": "for example, ", "i.e.,": "that is, "}
        for k, v in expr_replacements.items():
            text = text.replace(k, v)

        # 구두점 정리
        text = re.sub(r" ,", ",", text)
        text = re.sub(r" \.", ".", text)
        text = re.sub(r" !", "!", text)
        text = re.sub(r" \?", "?", text)
        text = re.sub(r" ;", ";", text)
        text = re.sub(r" :", ":", text)
        text = re.sub(r" '", "'", text)

        while '""' in text:
            text = text.replace('""', '"')
        while "''" in text:
            text = text.replace("''", "'")

        text = re.sub(r"\s+", " ", text).strip()

        if not re.search(r"[.!?;:,'\"')\]}…。」』】〉》›»]$", text):
            text += "."

        if lang not in self.AVAILABLE_LANGS:
            raise ValueError(f"Invalid language: {lang}")

        text = f"<{lang}>" + text + f"</{lang}>"
        return text

    def _get_text_mask(self, text_ids_lengths: np.ndarray) -> np.ndarray:
        return length_to_mask(text_ids_lengths)

    def _text_to_unicode_values(self, text: str) -> np.ndarray:
        return np.array([ord(char) for char in text], dtype=np.uint16)

    def __call__(self, text_list: list, lang_list: list) -> tuple:
        text_list = [self._preprocess_text(t, lang) for t, lang in zip(text_list, lang_list)]
        text_ids_lengths = np.array([len(text) for text in text_list], dtype=np.int64)
        text_ids = np.zeros((len(text_list), text_ids_lengths.max()), dtype=np.int64)

        for i, text in enumerate(text_list):
            unicode_vals = self._text_to_unicode_values(text)
            text_ids[i, :len(unicode_vals)] = np.array(
                [self.indexer[val] for val in unicode_vals], dtype=np.int64
            )

        text_mask = self._get_text_mask(text_ids_lengths)
        return text_ids, text_mask


def length_to_mask(lengths: np.ndarray, max_len: Optional[int] = None) -> np.ndarray:
    """길이를 바이너리 마스크로 변환"""
    max_len = max_len or lengths.max()
    ids = np.arange(0, max_len)
    mask = (ids < np.expand_dims(lengths, axis=1)).astype(np.float32)
    return mask.reshape(-1, 1, max_len)


def get_latent_mask(wav_lengths: np.ndarray, base_chunk_size: int, chunk_compress_factor: int) -> np.ndarray:
    latent_size = base_chunk_size * chunk_compress_factor
    latent_lengths = (wav_lengths + latent_size - 1) // latent_size
    return length_to_mask(latent_lengths)


def chunk_text(text: str, max_len: int = 300) -> list:
    """텍스트를 문단과 문장 단위로 분할"""
    import re

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n+", text.strip()) if p.strip()]
    chunks = []

    for paragraph in paragraphs:
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        pattern = r"(?<!Mr\.)(?<!Mrs\.)(?<!Ms\.)(?<!Dr\.)(?<!Prof\.)(?<!Sr\.)(?<!Jr\.)(?<!Ph\.D\.)(?<!etc\.)(?<!e\.g\.)(?<!i\.e\.)(?<!vs\.)(?<!Inc\.)(?<!Ltd\.)(?<!Co\.)(?<!Corp\.)(?<!St\.)(?<!Ave\.)(?<!Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+"
        sentences = re.split(pattern, paragraph)

        current_chunk = ""
        for sentence in sentences:
            if len(current_chunk) + len(sentence) + 1 <= max_len:
                current_chunk += (" " if current_chunk else "") + sentence
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = sentence

        if current_chunk:
            chunks.append(current_chunk.strip())

    return chunks


class TTSEngine:
    """CPU 전용 TTS 엔진"""

    def __init__(self):
        self.model = None
        self.sample_rate = 24000

    def init_model(self):
        """TTS 모델 초기화 (CPU 전용)"""
        if self.model is not None:
            return

        onnx_dir = os.path.join(ASSETS_DIR, 'onnx')

        # ONNX 세션 옵션 (CPU 전용)
        opts = ort.SessionOptions()
        providers = ["CPUExecutionProvider"]  # CPU만 사용
        print("TTS 모델 로드 중... (CPU 모드)")

        # 설정 로드
        cfg_path = os.path.join(onnx_dir, "tts.json")
        with open(cfg_path, "r") as f:
            cfgs = json.load(f)

        # ONNX 모델 로드
        dp_ort = ort.InferenceSession(
            os.path.join(onnx_dir, "duration_predictor.onnx"), sess_options=opts, providers=providers
        )
        text_enc_ort = ort.InferenceSession(
            os.path.join(onnx_dir, "text_encoder.onnx"), sess_options=opts, providers=providers
        )
        vector_est_ort = ort.InferenceSession(
            os.path.join(onnx_dir, "vector_estimator.onnx"), sess_options=opts, providers=providers
        )
        vocoder_ort = ort.InferenceSession(
            os.path.join(onnx_dir, "vocoder.onnx"), sess_options=opts, providers=providers
        )

        # 텍스트 프로세서
        unicode_indexer_path = os.path.join(onnx_dir, "unicode_indexer.json")
        text_processor = UnicodeProcessor(unicode_indexer_path)

        self.model = {
            'cfgs': cfgs,
            'text_processor': text_processor,
            'dp_ort': dp_ort,
            'text_enc_ort': text_enc_ort,
            'vector_est_ort': vector_est_ort,
            'vocoder_ort': vocoder_ort
        }

        self.sample_rate = cfgs["ae"]["sample_rate"]
        self.base_chunk_size = cfgs["ae"]["base_chunk_size"]
        self.chunk_compress_factor = cfgs["ttl"]["chunk_compress_factor"]
        self.ldim = cfgs["ttl"]["latent_dim"]

        print("TTS 모델 로드 완료! (CPU)")

    def load_voice_style(self, voice_name: str) -> Style:
        """음성 스타일 로드"""
        voice_path = os.path.join(ASSETS_DIR, 'voice_styles', get_voice_file(voice_name))

        with open(voice_path, "r") as f:
            voice_style = json.load(f)

        ttl_dims = voice_style["style_ttl"]["dims"]
        dp_dims = voice_style["style_dp"]["dims"]

        ttl_data = np.array(voice_style["style_ttl"]["data"], dtype=np.float32).flatten()
        ttl_style = ttl_data.reshape(1, ttl_dims[1], ttl_dims[2])

        dp_data = np.array(voice_style["style_dp"]["data"], dtype=np.float32).flatten()
        dp_style = dp_data.reshape(1, dp_dims[1], dp_dims[2])

        return Style(ttl_style, dp_style)

    def sample_noisy_latent(self, duration: np.ndarray) -> tuple:
        bsz = len(duration)
        wav_len_max = duration.max() * self.sample_rate
        wav_lengths = (duration * self.sample_rate).astype(np.int64)
        chunk_size = self.base_chunk_size * self.chunk_compress_factor
        latent_len = ((wav_len_max + chunk_size - 1) / chunk_size).astype(np.int32)
        latent_dim = self.ldim * self.chunk_compress_factor
        noisy_latent = np.random.randn(bsz, latent_dim, latent_len).astype(np.float32)
        latent_mask = get_latent_mask(wav_lengths, self.base_chunk_size, self.chunk_compress_factor)
        noisy_latent = noisy_latent * latent_mask
        return noisy_latent, latent_mask

    def _infer(self, text_list: list, lang_list: list, style: Style, total_step: int, speed: float) -> tuple:
        """단일 배치 추론"""
        bsz = len(text_list)
        m = self.model

        text_ids, text_mask = m['text_processor'](text_list, lang_list)

        dur_onnx, *_ = m['dp_ort'].run(
            None, {"text_ids": text_ids, "style_dp": style.dp, "text_mask": text_mask}
        )
        dur_onnx = dur_onnx / speed

        text_emb_onnx, *_ = m['text_enc_ort'].run(
            None, {"text_ids": text_ids, "style_ttl": style.ttl, "text_mask": text_mask}
        )

        xt, latent_mask = self.sample_noisy_latent(dur_onnx)
        total_step_np = np.array([total_step] * bsz, dtype=np.float32)

        for step in range(total_step):
            current_step = np.array([step] * bsz, dtype=np.float32)
            xt, *_ = m['vector_est_ort'].run(
                None,
                {
                    "noisy_latent": xt,
                    "text_emb": text_emb_onnx,
                    "style_ttl": style.ttl,
                    "text_mask": text_mask,
                    "latent_mask": latent_mask,
                    "current_step": current_step,
                    "total_step": total_step_np,
                },
            )

        wav, *_ = m['vocoder_ort'].run(None, {"latent": xt})
        return wav, dur_onnx

    def synthesize(self, text: str, language: str, voice_name: str,
                   speed: float = 1.0, quality: int = 5,
                   output_name: str = None, output_dir: str = None,
                   progress_callback=None) -> tuple:
        """음성 합성 메인 함수"""
        self.init_model()

        if not text or not text.strip():
            return None, "텍스트를 입력해주세요."

        try:
            if progress_callback:
                progress_callback(5, "텍스트 분석 중...")

            style = self.load_voice_style(voice_name)
            max_len = get_max_length(language)
            chunks = chunk_text(text, max_len=max_len)
            total_chunks = len(chunks) if chunks else 1

            if progress_callback:
                progress_callback(15, "TTS 모델 준비 완료")

            all_audio = []
            total_duration = 0.0

            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue

                if progress_callback:
                    prog = 20 + int((i / total_chunks) * 60)
                    preview = chunk[:30] + '...' if len(chunk) > 30 else chunk
                    progress_callback(prog, f'[{i + 1}/{total_chunks}] {preview}')

                wav, duration = self._infer([chunk], [language], style, quality, speed)
                w = wav[0, :int(self.sample_rate * duration[0].item())]
                all_audio.append(w)
                total_duration += duration[0].item()

                # 청크 사이 묵음
                if i < total_chunks - 1:
                    silence = np.zeros(int(0.3 * self.sample_rate), dtype=np.float32)
                    all_audio.append(silence)
                    total_duration += 0.3

            if progress_callback:
                progress_callback(85, "오디오 병합 중...")

            if len(all_audio) > 1:
                combined = np.concatenate(all_audio)
            else:
                combined = all_audio[0] if all_audio else np.array([], dtype=np.float32)

            if progress_callback:
                progress_callback(90, "파일 저장 중...")

            # 출력 파일명
            import datetime
            if output_name:
                filename = f"{output_name}.wav"
            else:
                timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = f"tts_{timestamp}.wav"

            # 출력 폴더 (지정되지 않으면 기본 OUTPUT_DIR)
            save_dir = output_dir if output_dir else OUTPUT_DIR
            os.makedirs(save_dir, exist_ok=True)
            filepath = f"{save_dir}/{filename}"
            sf.write(filepath, combined, self.sample_rate)

            if progress_callback:
                progress_callback(100, "완료!")

            return filepath, f"음성 생성 완료!\n파일: {filename}\n길이: {total_duration:.1f}초"

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None, f"오류 발생: {str(e)}"

    def synthesize_to_array(self, text: str, language: str, voice_name: str,
                            speed: float = 1.0, quality: int = 5,
                            progress_callback=None) -> tuple:
        """음성 합성 후 numpy 배열로 반환 (영상 생성용)"""
        self.init_model()

        if not text or not text.strip():
            return None, 0.0

        try:
            style = self.load_voice_style(voice_name)
            max_len = get_max_length(language)
            chunks = chunk_text(text, max_len=max_len)
            total_chunks = len(chunks) if chunks else 1

            all_audio = []
            total_duration = 0.0

            for i, chunk in enumerate(chunks):
                if not chunk.strip():
                    continue

                if progress_callback:
                    prog = 15 + int((i / total_chunks) * 25)
                    preview = chunk[:20] + '...' if len(chunk) > 20 else chunk
                    progress_callback(prog, f'음성 [{i + 1}/{total_chunks}] {preview}')

                wav, duration = self._infer([chunk], [language], style, quality, speed)
                w = wav[0, :int(self.sample_rate * duration[0].item())]
                all_audio.append(w)
                total_duration += duration[0].item()

                if i < total_chunks - 1:
                    silence = np.zeros(int(0.3 * self.sample_rate), dtype=np.float32)
                    all_audio.append(silence)
                    total_duration += 0.3

            if len(all_audio) > 1:
                combined = np.concatenate(all_audio)
            else:
                combined = all_audio[0] if all_audio else np.array([], dtype=np.float32)

            return combined, total_duration

        except Exception as e:
            import traceback
            traceback.print_exc()
            return None, 0.0


# 싱글톤 인스턴스
_tts_engine = None

def get_tts_engine() -> TTSEngine:
    global _tts_engine
    if _tts_engine is None:
        _tts_engine = TTSEngine()
    return _tts_engine
