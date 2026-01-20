# Supertonic Core Module
# Lazy imports to avoid circular dependencies

__all__ = [
    'TTSEngine',
    'SubtitleGenerator',
    'VideoGenerator',
    'read_text_file',
    'get_voice_list',
    'ensure_korean_font',
    'get_tts_engine',
    'get_subtitle_generator',
    'get_video_generator'
]

def __getattr__(name):
    if name == 'TTSEngine':
        from .tts import TTSEngine
        return TTSEngine
    elif name == 'get_tts_engine':
        from .tts import get_tts_engine
        return get_tts_engine
    elif name == 'SubtitleGenerator':
        from .subtitle import SubtitleGenerator
        return SubtitleGenerator
    elif name == 'get_subtitle_generator':
        from .subtitle import get_subtitle_generator
        return get_subtitle_generator
    elif name == 'VideoGenerator':
        from .video import VideoGenerator
        return VideoGenerator
    elif name == 'get_video_generator':
        from .video import get_video_generator
        return get_video_generator
    elif name in ('read_text_file', 'get_voice_list', 'ensure_korean_font'):
        from . import utils
        return getattr(utils, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
