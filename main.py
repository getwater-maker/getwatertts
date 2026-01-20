"""
Supertonic TTS - Eel Desktop Application
CPU 전용 로컬 데스크톱 앱
"""
import os
import sys
import subprocess
import platform

import eel

# 프로젝트 경로 설정
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

# Core 모듈 임포트
from core.utils import (
    read_text_file, get_voice_list, OUTPUT_DIR
)
from core.tts import get_tts_engine

# Eel 초기화
eel.init(os.path.join(BASE_DIR, 'eel_web'))


# ========== Eel Exposed Functions ==========

@eel.expose
def get_voices():
    """음성 목록 반환"""
    return get_voice_list()


@eel.expose
def read_text_file_eel(file_path):
    """텍스트 파일 읽기"""
    return read_text_file(file_path)


@eel.expose
def select_audio_file():
    """오디오 파일 선택 다이얼로그 열기"""
    import tkinter as tk
    from tkinter import filedialog

    try:
        # tkinter 윈도우 숨기기
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)  # 다이얼로그를 최상위로

        # 파일 선택 다이얼로그
        file_path = filedialog.askopenfilename(
            title="오디오 파일 선택",
            filetypes=[
                ("오디오 파일", "*.wav *.mp3"),
                ("WAV 파일", "*.wav"),
                ("MP3 파일", "*.mp3"),
                ("모든 파일", "*.*")
            ]
        )

        root.destroy()

        if file_path:
            return {"success": True, "filepath": file_path, "filename": os.path.basename(file_path)}
        else:
            return {"success": False, "message": "파일이 선택되지 않았습니다."}

    except Exception as e:
        print(f"파일 선택 실패: {e}")
        return {"success": False, "message": str(e)}


@eel.expose
def get_audio_url(filepath):
    """로컬 파일을 base64로 인코딩하여 반환"""
    import base64
    try:
        with open(filepath, 'rb') as f:
            audio_data = f.read()
        b64 = base64.b64encode(audio_data).decode('utf-8')
        return f"data:audio/wav;base64,{b64}"
    except Exception as e:
        print(f"오디오 로드 실패: {e}")
        return None


@eel.expose
def synthesize_sentence(text, language, voice_name, speed, quality, output_name, output_dir=None):
    """단일 문장 음성 합성 (진행률 콜백 없음)"""
    try:
        engine = get_tts_engine()
        filepath, message = engine.synthesize(
            text=text,
            language=language,
            voice_name=voice_name,
            speed=speed,
            quality=quality,
            output_name=output_name,
            output_dir=output_dir,
            progress_callback=None
        )

        if filepath:
            return {"success": True, "filepath": filepath, "message": message}
        else:
            return {"success": False, "message": message}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}


@eel.expose
def export_merged_audio(file_paths, output_name, output_dir=None, delete_temp_files=True):
    """여러 WAV 파일을 하나로 병합"""
    import numpy as np
    import soundfile as sf

    try:
        if not file_paths:
            return {"success": False, "message": "병합할 파일이 없습니다."}

        all_audio = []
        sample_rate = None
        valid_files = []  # 병합에 사용된 파일 목록

        for filepath in file_paths:
            if not filepath or not os.path.exists(filepath):
                continue

            data, sr = sf.read(filepath)
            if sample_rate is None:
                sample_rate = sr
            elif sr != sample_rate:
                # 샘플레이트가 다르면 리샘플링 필요 (여기서는 스킵)
                print(f"샘플레이트 불일치: {sr} != {sample_rate}")
                continue

            all_audio.append(data)
            valid_files.append(filepath)

            # 문장 사이 짧은 묵음 추가 (0.3초)
            silence = np.zeros(int(0.3 * sample_rate), dtype=data.dtype)
            all_audio.append(silence)

        if not all_audio:
            return {"success": False, "message": "유효한 오디오 파일이 없습니다."}

        # 마지막 묵음 제거
        all_audio = all_audio[:-1]

        # 병합
        merged = np.concatenate(all_audio)

        # 저장 (출력 폴더 지정 가능)
        save_dir = output_dir if output_dir else OUTPUT_DIR
        output_path = os.path.join(save_dir, f"{output_name}.wav")
        sf.write(output_path, merged, sample_rate)

        # 임시 파일 삭제 (병합 완료 후)
        deleted_count = 0
        if delete_temp_files:
            for temp_file in valid_files:
                try:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                        deleted_count += 1
                except Exception as del_err:
                    print(f"임시 파일 삭제 실패: {temp_file} - {del_err}")

        duration = len(merged) / sample_rate
        return {
            "success": True,
            "filepath": output_path,
            "message": f"내보내기 완료!\n파일: {output_name}.wav\n길이: {duration:.1f}초",
            "deleted_temp_files": deleted_count
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}


@eel.expose
def open_output_folder():
    """출력 폴더 열기"""
    try:
        if platform.system() == 'Windows':
            os.startfile(OUTPUT_DIR)
        elif platform.system() == 'Darwin':  # macOS
            subprocess.run(['open', OUTPUT_DIR])
        else:  # Linux
            subprocess.run(['xdg-open', OUTPUT_DIR])
    except Exception as e:
        print(f"폴더 열기 실패: {e}")


@eel.expose
def open_folder(file_path):
    """파일이 있는 폴더 열기"""
    try:
        folder_path = os.path.dirname(file_path) if os.path.isfile(file_path) else file_path
        if platform.system() == 'Windows':
            os.startfile(folder_path)
        elif platform.system() == 'Darwin':  # macOS
            subprocess.run(['open', folder_path])
        else:  # Linux
            subprocess.run(['xdg-open', folder_path])
    except Exception as e:
        print(f"폴더 열기 실패: {e}")


@eel.expose
def open_file(file_path):
    """파일을 기본 프로그램으로 열기"""
    try:
        if not os.path.exists(file_path):
            print(f"파일을 찾을 수 없습니다: {file_path}")
            return
        if platform.system() == 'Windows':
            os.startfile(file_path)
        elif platform.system() == 'Darwin':  # macOS
            subprocess.run(['open', file_path])
        else:  # Linux
            subprocess.run(['xdg-open', file_path])
    except Exception as e:
        print(f"파일 열기 실패: {e}")


@eel.expose
def analyze_external_audio(audio_path, subtitle_lines, language='ko'):
    """외부 오디오 파일(WAV/MP3) 분석하여 Forced Alignment 자막 타임코드 생성"""
    from core.subtitle import get_subtitle_generator
    from core.utils import TEMP_DIR

    try:
        if not audio_path or not os.path.exists(audio_path):
            return {"success": False, "message": "오디오 파일을 찾을 수 없습니다."}

        if not subtitle_lines:
            return {"success": False, "message": "자막 텍스트가 없습니다."}

        print(f"외부 오디오 Forced Alignment 분석 시작: {audio_path}")
        print(f"자막 줄 수: {len(subtitle_lines)}")

        # 파일 확장자 확인
        ext = os.path.splitext(audio_path)[1].lower()
        analysis_path = audio_path

        # MP3인 경우 WAV로 변환 (Stable-TS는 WAV 권장)
        if ext == '.mp3':
            print("MP3 파일 감지, WAV로 변환 중...")
            try:
                from pydub import AudioSegment
                audio = AudioSegment.from_mp3(audio_path)
                temp_wav_path = os.path.join(TEMP_DIR, "temp_external_audio.wav")
                audio.export(temp_wav_path, format="wav")
                analysis_path = temp_wav_path
                print(f"WAV 변환 완료: {temp_wav_path}")
            except ImportError:
                # pydub 없으면 ffmpeg 직접 사용
                print("pydub 없음, ffmpeg 직접 사용...")
                temp_wav_path = os.path.join(TEMP_DIR, "temp_external_audio.wav")
                import subprocess
                subprocess.run([
                    'ffmpeg', '-y', '-i', audio_path,
                    '-ar', '16000', '-ac', '1',
                    temp_wav_path
                ], capture_output=True)
                analysis_path = temp_wav_path

        # 오디오 길이 계산
        import soundfile as sf
        audio_info = sf.info(analysis_path)
        audio_duration = audio_info.duration

        # Stable-TS Forced Alignment으로 타임코드 생성
        generator = get_subtitle_generator()
        subtitle_text = '\n'.join(subtitle_lines)

        timings = generator.generate_timings_from_file(
            analysis_path, subtitle_text, language
        )
        print(f"Forced Alignment 완료, 타임코드 수: {len(timings)}")

        # SRT 형식 타임코드로 변환
        srt_timecodes = []
        for timing in timings:
            srt_timecodes.append({
                'start': seconds_to_srt_time(timing['start']),
                'end': seconds_to_srt_time(timing['end'])
            })

        # 임시 WAV 파일 정리
        if ext == '.mp3':
            try:
                temp_wav_path = os.path.join(TEMP_DIR, "temp_external_audio.wav")
                if os.path.exists(temp_wav_path):
                    os.remove(temp_wav_path)
            except:
                pass

        return {
            "success": True,
            "timecodes": srt_timecodes,
            "audio_duration": audio_duration,
            "message": f"{len(srt_timecodes)}개 자막 타임코드 생성 완료"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}


@eel.expose
def generate_subtitle_timecodes(audio_path, subtitle_lines):
    """Stable-TS Forced Alignment으로 자막 타임코드 생성"""
    from core.subtitle import get_subtitle_generator

    try:
        if not audio_path or not os.path.exists(audio_path):
            return {"success": False, "message": "오디오 파일을 찾을 수 없습니다."}

        if not subtitle_lines:
            return {"success": False, "message": "자막 텍스트가 없습니다."}

        # Stable-TS Forced Alignment으로 타임코드 생성
        generator = get_subtitle_generator()
        subtitle_text = '\n'.join(subtitle_lines)

        timings = generator.generate_timings_from_file(audio_path, subtitle_text, 'ko')

        # SRT 형식 타임코드로 변환
        srt_timecodes = []
        for timing in timings:
            srt_timecodes.append({
                'start': seconds_to_srt_time(timing['start']),
                'end': seconds_to_srt_time(timing['end'])
            })

        return {
            "success": True,
            "timecodes": srt_timecodes,
            "message": f"{len(srt_timecodes)}개 자막 타임코드 생성 완료"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}


@eel.expose
def export_srt_file(file_name, subtitle_lines, timecodes):
    """SRT 자막 파일 생성"""
    try:
        if not subtitle_lines or not timecodes:
            return {"success": False, "message": "자막 또는 타임코드가 없습니다."}

        srt_path = os.path.join(OUTPUT_DIR, f"{file_name}.srt")

        with open(srt_path, 'w', encoding='utf-8') as f:
            for i, (text, tc) in enumerate(zip(subtitle_lines, timecodes)):
                f.write(f"{i + 1}\n")
                f.write(f"{tc['start']} --> {tc['end']}\n")
                f.write(f"{text}\n\n")

        return {
            "success": True,
            "filepath": srt_path,
            "message": f"SRT 파일 저장 완료!\n파일: {file_name}.srt"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}


def seconds_to_srt_time(seconds):
    """초를 SRT 타임코드 형식으로 변환 (00:00:00,000)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def srt_time_to_milliseconds(srt_time):
    """SRT 타임코드를 밀리초로 변환 (00:00:00,000 -> ms)"""
    try:
        time_part, ms_part = srt_time.replace('.', ',').split(',')
        parts = time_part.split(':')
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
        milliseconds = int(ms_part.ljust(3, '0')[:3])
        total_ms = (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds
        return total_ms
    except:
        return 0


def generate_vrew_id(length=10):
    """Vrew 스타일 랜덤 ID 생성 (예: rb8EFhsnl-)"""
    import random
    import string
    chars = string.ascii_letters + string.digits + '-_'
    return ''.join(random.choice(chars) for _ in range(length))


def srt_time_to_seconds(srt_time):
    """SRT 타임코드를 초 단위로 변환 (00:00:00,000 -> seconds)"""
    try:
        time_part, ms_part = srt_time.replace('.', ',').split(',')
        parts = time_part.split(':')
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
        milliseconds = int(ms_part.ljust(3, '0')[:3])
        total_seconds = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
        return round(total_seconds, 2)
    except:
        return 0.0


@eel.expose
def export_vrew_file(file_name, wav_path, subtitle_lines, timecodes, output_dir=None):
    """Vrew 프로젝트 파일(.vrew) 생성 - Vrew 3.5.4 호환"""
    import json
    import zipfile
    import uuid
    import soundfile as sf
    from datetime import datetime

    try:
        if not wav_path or not os.path.exists(wav_path):
            return {"success": False, "message": "WAV 파일을 찾을 수 없습니다."}

        if not subtitle_lines or not timecodes:
            return {"success": False, "message": "자막 또는 타임코드가 없습니다."}

        # 오디오 정보 가져오기
        audio_data, sample_rate = sf.read(wav_path)
        audio_duration = len(audio_data) / sample_rate  # 초 단위
        channels = 1 if len(audio_data.shape) == 1 else audio_data.shape[1]
        file_size = os.path.getsize(wav_path)

        # 고유 ID 생성
        media_id = str(uuid.uuid4())
        project_id = str(uuid.uuid4())
        wav_filename = os.path.basename(wav_path)

        # Vrew words 및 clips 생성
        clips = []

        for i, (text, tc) in enumerate(zip(subtitle_lines, timecodes)):
            # 텍스트 정리 (캐리지 리턴 제거)
            clean_text = text.strip().replace('\r', '').replace('\n', '')

            start_sec = srt_time_to_seconds(tc['start'])
            end_sec = srt_time_to_seconds(tc['end'])
            duration_sec = round(end_sec - start_sec, 2)

            # 이 자막에 대한 words 배열
            words = []

            # 텍스트 단어 (type: 0)
            words.append({
                "id": generate_vrew_id(),
                "text": clean_text,
                "startTime": start_sec,
                "duration": duration_sec,
                "aligned": True,
                "type": 0,
                "originalDuration": duration_sec,
                "originalStartTime": start_sec,
                "truncatedWords": [],
                "autoControl": False,
                "mediaId": media_id,
                "audioIds": [],
                "assetIds": [],
                "playbackRate": 1
            })

            # 다음 자막과의 간격 확인 (묵음 추가)
            gap = 0
            if i < len(subtitle_lines) - 1:
                next_start_sec = srt_time_to_seconds(timecodes[i + 1]['start'])
                gap = round(next_start_sec - end_sec, 2)
                if gap > 0.01:
                    # 묵음 (type: 1)
                    words.append({
                        "id": generate_vrew_id(),
                        "text": "",
                        "startTime": end_sec,
                        "duration": gap,
                        "aligned": True,
                        "type": 1,
                        "originalDuration": gap,
                        "originalStartTime": end_sec,
                        "truncatedWords": [],
                        "autoControl": False,
                        "mediaId": media_id,
                        "audioIds": [],
                        "assetIds": [],
                        "playbackRate": 1
                    })

            # 줄바꿈 (type: 2) - 모든 클립에 추가 (마지막 클립 포함)
            words.append({
                "id": generate_vrew_id(),
                "text": "",
                "startTime": end_sec + (gap if gap > 0 else 0),
                "duration": 0,
                "aligned": False,
                "type": 2,
                "originalDuration": 0,
                "originalStartTime": end_sec + (gap if gap > 0 else 0),
                "truncatedWords": [],
                "autoControl": False,
                "mediaId": media_id,
                "audioIds": [],
                "assetIds": [],
                "playbackRate": 1
            })

            # clip 생성
            clip = {
                "words": words,
                "captionMode": "MANUAL",
                "captions": [
                    {
                        "text": [
                            {
                                "insert": clean_text,
                                "attributes": {
                                    "font": "Noto Sans KR_700",
                                    "size": "150",
                                    "color": "#ffffff",
                                    "outline-on": "true",
                                    "outline-color": "#000000",
                                    "outline-width": "6"
                                }
                            },
                            {"insert": "\n"}
                        ],
                        "style": {
                            "mediaId": "uc-0010-simple-textbox",
                            "yAlign": "middle",
                            "yOffset": 0.075,
                            "xOffset": 0,
                            "rotation": 0,
                            "width": 0.96,
                            "customAttributes": [
                                {"attributeName": "--textbox-color", "type": "color-hex", "value": "rgba(0, 0, 0, 0)"},
                                {"attributeName": "--textbox-align", "type": "textbox-align", "value": "center"}
                            ],
                            "scaleFactor": 1.7777777777777777
                        }
                    },
                    {"text": [{"insert": "\n"}]}
                ],
                "assetIds": [],
                "dirty": {"blankDeleted": False, "caption": False, "video": False},
                "translationModified": {"result": False, "source": False},
                "id": generate_vrew_id(),
                "audioIds": []
            }
            clips.append(clip)

        # 현재 시간
        from datetime import timezone
        now = datetime.now()
        now_utc = datetime.now(timezone.utc)
        # comment용 UTC 시간
        comment_time = now_utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now_utc.microsecond // 1000:03d}Z"
        # saveInfo용 로컬 시간 (+09:00 형식)
        local_offset = now.astimezone().strftime("%z")
        local_offset_formatted = f"{local_offset[:3]}:{local_offset[3:]}"
        save_date = now.strftime("%Y-%m-%dT%H:%M:%S") + local_offset_formatted

        # Vrew project.json 구조 생성
        project_json = {
            "version": 15,
            "files": [
                {
                    "version": 1,
                    "mediaId": media_id,
                    "sourceOrigin": "USER",
                    "fileSize": file_size,
                    "name": wav_filename,
                    "type": "AVMedia",
                    "videoAudioMetaInfo": {
                        "audioInfo": {
                            "sampleRate": int(sample_rate),
                            "codec": "wav",
                            "channelCount": int(channels)
                        },
                        "duration": round(audio_duration, 2),
                        "presumedDevice": "unknown",
                        "mediaContainer": "wav"
                    },
                    "sourceFileType": "VIDEO_AUDIO",
                    "fileLocation": "LOCAL",
                    "path": wav_path,
                    "relativePath": f"./sources/{wav_filename}"
                }
            ],
            "transcript": {
                "scenes": [
                    {
                        "id": generate_vrew_id(),
                        "clips": clips,
                        "name": "",
                        "dirty": {"video": False}
                    }
                ]
            },
            "props": {
                "assets": {},
                "audios": {},
                "overdubInfos": {},
                "analyzeDate": now.strftime("%Y-%m-%d %H:%M:%S"),
                "captionDisplayMode": {"0": True, "1": False},
                "mediaEffectMap": {},
                "markerNames": {"0": "", "1": "", "2": "", "3": "", "4": "", "5": ""},
                "flipSetting": {},
                "videoRatio": 1.7777777777777777,
                "globalVideoTransform": {"zoom": 1, "xPos": 0, "yPos": 0, "rotation": 0},
                "videoSize": {"width": 1920, "height": 1080},
                "backgroundMap": {},
                "globalCaptionStyle": {
                    "captionStyleSetting": {
                        "mediaId": "uc-0010-simple-textbox",
                        "yAlign": "middle",
                        "yOffset": 0.075,
                        "xOffset": 0,
                        "rotation": 0,
                        "width": 0.96,
                        "customAttributes": [
                            {"attributeName": "--textbox-color", "type": "color-hex", "value": "rgba(0, 0, 0, 0)"},
                            {"attributeName": "--textbox-align", "type": "textbox-align", "value": "center"}
                        ],
                        "scaleFactor": 1.7777777777777777
                    },
                    "quillStyle": {
                        "font": "Noto Sans KR_700",
                        "size": "150",
                        "color": "#ffffff",
                        "outline-on": "true",
                        "outline-color": "#000000",
                        "outline-width": "6"
                    }
                },
                "initProjectVideoSize": {"width": 1920, "height": 1080},
                "pronunciationDisplay": True,
                "projectAudioLanguage": "ko",
                "audioLanguagesMap": {media_id: "ko"},
                "originalClipsMap": {},
                "ttsClipInfosMap": {},
                "lastTTSSettings": {
                    "pitch": 0,
                    "speed": 0,
                    "volume": 0,
                    "speaker": {
                        "age": "youth",
                        "gender": "female",
                        "lang": "ko-KR",
                        "name": "100",
                        "speakerId": "100",
                        "provider": "vrew",
                        "badge": "Recommended",
                        "versions": ["v1"],
                        "free": True,
                        "tags": ["bright", "clear"]
                    },
                    "version": "v1"
                }
            },
            "comment": f"3.5.4\t{comment_time}",
            "projectId": project_id,
            "statistics": {
                "wordCursorCount": {"0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0},
                "wordSelectionCount": {"0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0},
                "wordCorrectionCount": {"0": 0, "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "6": 0, "7": 0},
                "projectStartMode": "unknown",
                "saveInfo": {
                    "created": {"version": "3.5.4", "date": save_date, "stage": "release"},
                    "updated": {"version": "3.5.4", "date": save_date, "stage": "release"},
                    "loadCount": 0,
                    "saveCount": 1
                },
                "savedStyleApplyCount": 0,
                "cumulativeTemplateApplyCount": 0,
                "ratioChangedByTemplate": False,
                "videoRemixInfos": {},
                "isAIWritingUsed": False,
                "clientLinebreakExecuteCount": 0,
                "agentStats": {"isEdited": False, "requestCount": 0, "responseCount": 0, "toolCallCount": 0, "toolErrorCount": 0}
            },
            "lastTTSSettings": {
                "pitch": 0,
                "speed": 0,
                "volume": 0,
                "speaker": {
                    "age": "youth",
                    "gender": "female",
                    "lang": "ko-KR",
                    "name": "100",
                    "speakerId": "100",
                    "provider": "vrew",
                    "badge": "Recommended",
                    "versions": ["v1"],
                    "free": True,
                    "tags": ["bright", "clear"]
                },
                "version": "v1"
            }
        }

        # .vrew 파일 생성 (ZIP 압축, 출력 폴더 지정 가능)
        save_dir = output_dir if output_dir else OUTPUT_DIR
        vrew_path = os.path.join(save_dir, f"{file_name}.vrew")

        with zipfile.ZipFile(vrew_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # project.json 추가
            zf.writestr('project.json', json.dumps(project_json, ensure_ascii=False))

        return {
            "success": True,
            "filepath": vrew_path,
            "message": f"Vrew 프로젝트 저장 완료!\n파일: {file_name}.vrew"
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "message": str(e)}


# ========== Main Entry Point ==========

def main():
    print("=" * 50)
    print("Supertonic TTS - Desktop Edition")
    print("=" * 50)
    print(f"출력 폴더: {OUTPUT_DIR}")
    print("CPU 전용 모드로 실행됩니다.")
    print("=" * 50)

    # TTS 모델 미리 로드
    print("TTS 모델 초기화 중...")
    engine = get_tts_engine()
    engine.init_model()

    # 브라우저 모드 설정
    browser_mode = 'chrome'

    # Chrome 경로 확인 (Windows)
    if platform.system() == 'Windows':
        chrome_paths = [
            os.path.expandvars(r'%ProgramFiles%\Google\Chrome\Application\chrome.exe'),
            os.path.expandvars(r'%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe'),
            os.path.expandvars(r'%LocalAppData%\Google\Chrome\Application\chrome.exe'),
        ]
        chrome_found = any(os.path.exists(p) for p in chrome_paths)
        if not chrome_found:
            browser_mode = 'edge'

    print(f"브라우저: {browser_mode}")
    print("앱을 시작합니다...")

    # Eel 앱 시작 (최대화 상태로)
    try:
        eel.start(
            'index.html',
            mode=browser_mode,
            port=8080,
            host='localhost',
            size=(None, None),  # 크기 제한 없음
            position=(0, 0),
            cmdline_args=['--start-maximized', '--window-size=1920,1080']
        )
    except Exception as e:
        print(f"브라우저 시작 실패: {e}")
        print("기본 브라우저로 시도합니다...")
        eel.start(
            'index.html',
            mode='default',
            port=8080,
            host='localhost',
            cmdline_args=['--start-maximized']
        )


if __name__ == '__main__':
    main()
