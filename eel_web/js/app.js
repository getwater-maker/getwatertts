/**
 * Supertonic TTS - Sentence-by-Sentence TTS with Subtitle Tab
 */

// 전역 상태
let voiceSentences = [];          // 음성 탭 클립 배열 [{id: 'clip_xxx', text: '문장'}, ...]
let subtitleSentences = [];       // 자막 탭 문장 배열
let audioFiles = {};              // 생성된 오디오 파일 경로 {clipId: filepath}
let audioDurations = {};          // 클립별 재생 시간 {clipId: seconds}
let audioCache = {};              // base64 오디오 캐시 {clipId: base64data}
let audioCacheOrder = [];         // 캐시 추가 순서 (LRU 관리용)
const MAX_AUDIO_CACHE = 10;       // 메모리 절약을 위한 캐시 최대 개수
let clipIdCounter = 0;            // 클립 ID 카운터

// 고유 클립 ID 생성
function generateClipId() {
    return `clip_${++clipIdCounter}_${Date.now()}`;
}

// clipId를 짧은 해시로 변환 (WAV 파일명용)
function clipIdToHash(clipId) {
    let hash = 0;
    for (let i = 0; i < clipId.length; i++) {
        const char = clipId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // 32bit 정수로 변환
    }
    // 양수로 변환 후 16진수 6자리
    return Math.abs(hash).toString(16).padStart(6, '0').slice(0, 6);
}

// audioCache에 항목 추가 (LRU 방식으로 오래된 항목 자동 제거)
function addToAudioCache(clipId, data) {
    // 이미 있으면 순서만 업데이트
    const existingIndex = audioCacheOrder.indexOf(clipId);
    if (existingIndex !== -1) {
        audioCacheOrder.splice(existingIndex, 1);
    }

    // 캐시가 가득 차면 가장 오래된 항목 제거
    while (audioCacheOrder.length >= MAX_AUDIO_CACHE) {
        const oldestId = audioCacheOrder.shift();
        delete audioCache[oldestId];
        console.log(`audioCache에서 오래된 항목 제거: ${oldestId}`);
    }

    // 새 항목 추가
    audioCache[clipId] = data;
    audioCacheOrder.push(clipId);
}

// audioCache에서 항목 제거
function removeFromAudioCache(clipId) {
    delete audioCache[clipId];
    const index = audioCacheOrder.indexOf(clipId);
    if (index !== -1) {
        audioCacheOrder.splice(index, 1);
    }
}

// 텍스트 배열을 클립 객체 배열로 변환
function textsToClips(texts) {
    return texts.map(text => ({
        id: generateClipId(),
        text: text
    }));
}

// 클립 객체 배열에서 텍스트 배열 추출
function clipsToTexts(clips) {
    return clips.map(clip => clip.text);
}
let subtitleTimecodes = [];       // 자막 탭 타임코드 배열 [{start: "00:00:00,000", end: "00:00:00,000"}, ...]
let currentFileName = '';         // 현재 파일명 (확장자 제외) - 마지막으로 선택된 파일
let currentFilePath = '';         // 대본 파일 전체 경로
let currentFileDir = '';          // 대본 파일이 있는 폴더 경로
let scriptFileName = '';          // 대본 파일명 (확장자 제외) - WAV 내보내기용
let subtitleFileName = '';        // 자막 파일명
let externalAudioPath = '';       // 외부 오디오 파일 경로 (자막 싱크용)
let externalAudioFileName = '';   // 외부 오디오 파일명
let isProcessing = false;         // 처리 중 여부
let currentPlayerIndex = 0;       // 전체 듣기 현재 인덱스
let isPlaying = false;            // 전체 듣기 재생 중
let globalAudio = null;           // 전체 듣기용 오디오 객체
let currentTab = 'voice';         // 현재 탭 ('voice' 또는 'subtitle')
let lastExportedFilePath = '';    // 마지막 내보낸 파일 경로
let isMerging = false;            // 클립 병합 중 플래그
let isSplitting = false;          // 클립 분할 중 플래그
let stopRequested = false;        // 중단 요청 플래그
let currentSentenceAudio = null;  // 단일 문장 재생용 오디오 객체
let currentSentenceClipId = null; // 현재 재생 중인 클립 ID
let selectedClipIndex = -1;       // 선택된 클립 인덱스 (-1이면 처음부터)
const CLIP_GAP_MS = 500;          // 클립 사이 무음 간격 (밀리초)

// Undo/Redo 히스토리 (각 탭별 20단계)
const MAX_HISTORY = 20;
let voiceHistory = [];            // 음성 탭 히스토리 스택
let voiceHistoryIndex = -1;       // 음성 탭 현재 히스토리 위치
let subtitleHistory = [];         // 자막 탭 히스토리 스택
let subtitleHistoryIndex = -1;    // 자막 탭 현재 히스토리 위치

// DOM 요소
const elements = {};

// 초기화
document.addEventListener('DOMContentLoaded', async () => {
    initElements();
    initEventListeners();
    await loadVoiceList();

    // 창 최대화 시도
    try {
        // 화면 크기로 창 이동 및 리사이즈
        window.moveTo(0, 0);
        window.resizeTo(screen.availWidth, screen.availHeight);
    } catch (e) {
        console.log('창 최대화 실패:', e);
    }
});

// DOM 요소 초기화
function initElements() {
    elements.language = document.getElementById('language');
    elements.voice = document.getElementById('voice');
    elements.quality = document.getElementById('quality');
    elements.speed = document.getElementById('speed');
    elements.playAllBtn = document.getElementById('play-all-btn');
    elements.regenerateAllBtn = document.getElementById('regenerate-all-btn');
    elements.exportBtn = document.getElementById('export-btn');
    elements.progressSection = document.getElementById('progress-section');
    elements.progressFill = document.getElementById('progress-fill');
    elements.progressText = document.getElementById('progress-text');

    // 탭 관련 요소
    elements.voiceTab = document.getElementById('voice-tab');
    elements.subtitleTab = document.getElementById('subtitle-tab');
    elements.voiceContainer = document.getElementById('voice-container');
    elements.subtitleContainer = document.getElementById('subtitle-container');
    elements.tabBtns = document.querySelectorAll('.tab-btn');
    elements.subtitleFileInfo = document.getElementById('subtitle-file-info');

    // 인라인 플레이어 관련
    elements.inlinePlayer = document.getElementById('inline-player');
    elements.playerPrev = document.getElementById('player-prev');
    elements.playerPlay = document.getElementById('player-play');
    elements.playerNext = document.getElementById('player-next');
    elements.playerStatus = document.getElementById('player-status');
    elements.playerSpeedSelect = document.getElementById('player-speed-select');
    elements.playerClose = document.getElementById('player-close');
    elements.playerProgressContainer = document.getElementById('player-progress-container');
    elements.playerProgressBar = document.getElementById('player-progress-bar');
    elements.playerTime = document.getElementById('player-time');
    elements.exportResult = document.getElementById('export-result');
    elements.exportMessage = document.getElementById('export-message');
    elements.openFolderBtn = document.getElementById('open-folder-btn');
    elements.openFileBtn = document.getElementById('open-file-btn');

    // 자막 파일 선택 버튼
    elements.subtitleInputBtn = document.getElementById('subtitle-input-btn');
    elements.subtitleFileLabel = document.getElementById('subtitle-file-label');

    // 대본 파일 선택 버튼
    elements.scriptInputBtn = document.getElementById('script-input-btn');
    elements.scriptFileLabel = document.getElementById('script-file-label');

    // 동영상→대본 추출 버튼
    elements.videoTranscribeBtn = document.getElementById('video-transcribe-btn');
    elements.videoFileLabel = document.getElementById('video-file-label');

    // 내보내기 드롭다운
    elements.exportMenu = document.getElementById('export-menu');
    elements.exportWavBtn = document.getElementById('export-wav-btn');
    elements.exportVrewBtn = document.getElementById('export-vrew-btn');

    // 중단 버튼
    elements.stopBtn = document.getElementById('stop-btn');

    // 오디오 파일 선택 버튼
    elements.audioInputBtn = document.querySelector('.audio-input-btn');
    elements.audioFileLabel = document.getElementById('audio-file-label');

    // 초기화 버튼
    elements.resetBtn = document.getElementById('reset-btn');

    // 타임코드 재생성 버튼
    elements.regenerateTimecodeBtn = document.getElementById('regenerate-timecode-btn');
}

// 이벤트 리스너 초기화
function initEventListeners() {
    // 대본 파일 선택 - 버튼 클릭으로 Python 다이얼로그 열기
    elements.scriptInputBtn.addEventListener('click', handleFileSelect);

    // 동영상→대본 추출 버튼
    elements.videoTranscribeBtn.addEventListener('click', handleVideoTranscribe);

    // 자막 파일 선택 - 버튼 클릭으로 Python 다이얼로그 열기
    elements.subtitleInputBtn.addEventListener('click', handleSubtitleFileSelect);

    // 오디오 파일 선택 (자막 싱크용) - 버튼 클릭으로 Python 다이얼로그 열기
    elements.audioInputBtn.addEventListener('click', handleAudioFileSelect);

    // 타임코드 재생성 버튼
    elements.regenerateTimecodeBtn.addEventListener('click', handleRegenerateTimecode);

    // 탭 전환
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 전체 듣기
    elements.playAllBtn.addEventListener('click', startPlayAll);

    // 전체 재생성 (음성 변경 후 모든 문장 다시 TTS)
    elements.regenerateAllBtn.addEventListener('click', regenerateAllSentences);

    // 내보내기 드롭다운
    elements.exportBtn.addEventListener('click', toggleExportMenu);
    elements.exportWavBtn.addEventListener('click', () => {
        hideExportMenu();
        exportMergedAudio();
    });
    elements.exportVrewBtn.addEventListener('click', () => {
        hideExportMenu();
        exportVrewProject();
    });

    // 메뉴 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.export-dropdown')) {
            hideExportMenu();
        }
    });

    // 플레이어 컨트롤
    elements.playerPrev.addEventListener('click', playerPrev);
    elements.playerPlay.addEventListener('click', playerToggle);
    elements.playerNext.addEventListener('click', playerNext);
    elements.playerClose.addEventListener('click', closePlayer);
    elements.playerSpeedSelect.addEventListener('change', updatePlayerSpeed);

    // 프로그레스바 클릭으로 특정 구간 이동
    elements.playerProgressContainer.addEventListener('click', seekToPosition);

    // 폴더 열기 (대본 파일 폴더 또는 내보낸 파일 폴더)
    elements.openFolderBtn.addEventListener('click', () => {
        if (lastExportedFilePath) {
            eel.open_folder(lastExportedFilePath)();
        } else if (currentFileDir) {
            eel.open_folder(currentFileDir)();
        } else {
            eel.open_output_folder()();
        }
    });

    // 파일 열기
    elements.openFileBtn.addEventListener('click', () => {
        if (lastExportedFilePath) {
            eel.open_file(lastExportedFilePath)();
        }
    });

    // 중단 버튼
    elements.stopBtn.addEventListener('click', stopProcessing);

    // 초기화 버튼
    elements.resetBtn.addEventListener('click', resetAll);

    // Undo/Redo 키보드 단축키 (Ctrl+Z, Ctrl+Shift+Z)
    document.addEventListener('keydown', (e) => {
        // input 필드에서 입력 중이면 기본 동작 유지 (브라우저 기본 Undo/Redo)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            // Ctrl+Z: Undo
            e.preventDefault();
            handleUndo();
        } else if (e.ctrlKey && e.shiftKey && e.key === 'Z') {
            // Ctrl+Shift+Z: Redo
            e.preventDefault();
            handleRedo();
        }
    });
}

// 탭 전환
function switchTab(tabName) {
    currentTab = tabName;

    // 탭 버튼 활성화
    elements.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // 탭 컨텐츠 표시
    elements.voiceTab.classList.toggle('active', tabName === 'voice');
    elements.subtitleTab.classList.toggle('active', tabName === 'subtitle');
}

// 음성 목록 로드
async function loadVoiceList() {
    try {
        const voices = await eel.get_voices()();
        elements.voice.innerHTML = '';
        voices.forEach(v => {
            const option = document.createElement('option');
            option.value = v.value;
            option.textContent = v.label;
            elements.voice.appendChild(option);
        });
    } catch (error) {
        console.error('음성 목록 로드 실패:', error);
    }
}

// 파일 선택 핸들러 (Python 다이얼로그 사용)
async function handleFileSelect(e) {
    // Python tkinter 다이얼로그로 파일 선택
    const result = await eel.select_script_file()();

    if (!result.success) {
        return;
    }

    const fullName = result.filename;
    currentFileName = fullName.replace(/\.[^/.]+$/, '');
    scriptFileName = currentFileName;  // 대본 파일명 별도 저장
    currentFilePath = result.filepath;
    currentFileDir = result.folderpath;

    // 파일명 라벨 업데이트
    elements.scriptFileLabel.textContent = fullName;
    elements.scriptFileLabel.classList.add('has-file');

    const ext = fullName.split('.').pop().toLowerCase();

    try {
        let content = '';

        if (ext === 'txt' || ext === 'docx') {
            content = await eel.read_text_file_eel(currentFilePath)();
        } else {
            alert('지원하지 않는 파일 형식입니다. TXT 또는 DOCX 파일을 선택해주세요.');
            return;
        }

        if (!content || content.startsWith('지원하지 않는') || content.startsWith('파일 읽기 오류')) {
            alert(content || '파일을 읽을 수 없습니다.');
            return;
        }

        // 음성 탭: 문장 분리 후 클립 객체로 변환
        const sentences = splitIntoSentences(content);

        if (sentences.length === 0) {
            alert('파일에 내용이 없습니다.');
            return;
        }

        // 클립 객체 배열로 변환
        voiceSentences = textsToClips(sentences);

        // 초기화 (객체로 관리)
        audioFiles = {};
        audioDurations = {};
        audioCache = {};
        audioCacheOrder = [];
        updateTotalDuration();

        // 음성 탭 렌더링
        renderVoiceSentences();

        // 음성 탭 히스토리 초기화
        initVoiceHistory();

        // 자막 탭 초기화 (별도 파일 선택 필요)
        if (subtitleSentences.length === 0) {
            renderSubtitleSentences();
        }

        // TTS 변환 시작
        await processAllSentences();

    } catch (error) {
        console.error('파일 처리 오류:', error);
        alert('파일 처리 중 오류가 발생했습니다: ' + error.message);
    }
}

// 동영상→대본 추출 핸들러 (Whisper 음성인식)
async function handleVideoTranscribe() {
    // Python tkinter 다이얼로그로 파일 선택
    const result = await eel.select_video_file()();

    if (!result.success) {
        return;
    }

    const fullName = result.filename;
    currentFileName = fullName.replace(/\.[^/.]+$/, '');
    scriptFileName = currentFileName;
    currentFilePath = result.filepath;
    currentFileDir = result.folderpath;

    // UI 업데이트
    elements.videoFileLabel.textContent = '처리중...';
    elements.videoTranscribeBtn.disabled = true;
    elements.progressSection.classList.remove('hidden');

    try {
        // Whisper로 음성→텍스트 변환
        const transcribeResult = await eel.transcribe_video(
            result.filepath,
            elements.language.value
        )();

        if (!transcribeResult.success) {
            alert('음성 인식 실패: ' + transcribeResult.message);
            elements.videoFileLabel.textContent = '🎬 추출';
            elements.videoTranscribeBtn.disabled = false;
            elements.progressSection.classList.add('hidden');
            return;
        }

        // 변환된 문장 배열로 음성 탭에 로드
        const sentences = transcribeResult.sentences;

        if (sentences.length === 0) {
            alert('인식된 텍스트가 없습니다.');
            elements.videoFileLabel.textContent = '🎬 추출';
            elements.videoTranscribeBtn.disabled = false;
            elements.progressSection.classList.add('hidden');
            return;
        }

        // 클립 객체 배열로 변환
        voiceSentences = textsToClips(sentences);

        // 초기화
        audioFiles = {};
        audioDurations = {};
        audioCache = {};
        audioCacheOrder = [];
        updateTotalDuration();

        // 음성 탭 렌더링
        renderVoiceSentences();

        // 음성 탭 히스토리 초기화
        initVoiceHistory();

        // UI 업데이트
        elements.videoFileLabel.textContent = '✓ 완료';
        elements.videoTranscribeBtn.disabled = false;
        elements.scriptFileLabel.textContent = `${fullName} (추출)`;
        elements.scriptFileLabel.classList.add('has-file');

        // 음성 탭으로 전환
        switchTab('voice');

        // 저장된 파일 경로 표시
        let message = `${sentences.length}개 문장이 추출되었습니다.`;
        if (transcribeResult.txt_path) {
            message += `\n\n대본 저장: ${transcribeResult.txt_path}`;
        }
        message += `\n\n필요시 문장을 수정한 후 TTS 변환을 진행하세요.`;
        alert(message);

        // TTS 변환은 사용자가 확인 후 진행하도록 변경
        // 바로 TTS를 원하면 아래 주석 해제
        // await processAllSentences();

    } catch (error) {
        console.error('음성 인식 오류:', error);
        alert('음성 인식 중 오류가 발생했습니다: ' + error.message);
    }

    elements.videoTranscribeBtn.disabled = false;
    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
        elements.videoFileLabel.textContent = '🎬 추출';
    }, 2000);
}

// 자막 파일 선택 핸들러
async function handleSubtitleFileSelect(e) {
    // Python tkinter 다이얼로그로 파일 선택
    const result = await eel.select_subtitle_file()();

    if (!result.success) {
        return;
    }

    const content = result.content;

    if (!content || content.trim().length === 0) {
        alert('자막 파일이 비어있습니다.');
        return;
    }

    // 자막 파일 로드 성공 - 폴더 경로도 저장
    subtitleFileName = result.filename;
    currentFilePath = result.filepath;
    currentFileDir = result.folderpath;
    currentFileName = subtitleFileName.replace(/\.[^/.]+$/, '');

    subtitleSentences = content.split('\n').filter(line => line.trim().length > 0);
    subtitleTimecodes = new Array(subtitleSentences.length).fill(null).map(() => ({
        start: '00:00:00,000',
        end: '00:00:00,000'
    }));

    // UI 업데이트
    elements.subtitleFileLabel.textContent = subtitleFileName;
    elements.subtitleFileLabel.classList.add('has-file');
    elements.subtitleFileInfo.textContent = `📄 ${subtitleFileName}`;

    console.log('자막 파일 로드 성공:', subtitleFileName, '문장 수:', subtitleSentences.length, '폴더:', currentFileDir);

    // 자막 탭 렌더링
    renderSubtitleSentences();

    // 자막 탭 히스토리 초기화
    initSubtitleHistory();

    // 자막 탭으로 전환
    switchTab('subtitle');
}

// 오디오 파일 선택 핸들러 (자막 싱크용)
async function handleAudioFileSelect(e) {
    // HTML file input 대신 Python 파일 다이얼로그 사용
    try {
        const result = await eel.select_audio_file()();

        if (!result.success) {
            // 사용자가 취소한 경우 조용히 무시
            if (result.message !== '파일이 선택되지 않았습니다.') {
                alert(result.message);
            }
            return;
        }

        externalAudioPath = result.filepath;
        externalAudioFileName = result.filename;

        // UI 업데이트
        elements.audioFileLabel.textContent = externalAudioFileName;
        elements.audioInputBtn.classList.add('loaded');

        console.log('오디오 파일 선택:', externalAudioFileName, externalAudioPath);

        // 폴더 경로 업데이트 (자막 파일이 없는 경우)
        if (!currentFileDir && result.folderpath) {
            currentFileDir = result.folderpath;
        }

        // 파일명 업데이트 (확장자 제외)
        if (!currentFileName) {
            currentFileName = externalAudioFileName.replace(/\.[^/.]+$/, '');
        }

        // 자막 파일이 이미 로드되어 있으면 자동으로 타임코드 생성
        if (subtitleSentences.length > 0) {
            await generateTimecodeFromExternalAudio();
        } else {
            alert('자막 파일을 먼저 선택하세요.\n자막 + 오디오 파일이 모두 있어야 타임코드를 생성할 수 있습니다.');
        }

    } catch (error) {
        console.error('오디오 파일 선택 오류:', error);
        alert('오디오 파일 선택 중 오류가 발생했습니다.');
    }
}

// 외부 오디오 파일로 타임코드 생성
async function generateTimecodeFromExternalAudio() {
    if (!externalAudioPath || subtitleSentences.length === 0) {
        alert('자막 파일과 오디오 파일을 모두 선택해주세요.');
        return;
    }

    elements.progressSection.classList.remove('hidden');
    updateProgress(0, '오디오 파일 분석 준비 중...');

    try {
        updateProgress(10, 'Whisper 분석 시작...');

        // Python 백엔드 호출
        const result = await eel.analyze_external_audio(
            externalAudioPath,
            subtitleSentences,
            elements.language.value
        )();

        if (!result.success) {
            throw new Error(result.message);
        }

        updateProgress(90, '타임코드 적용 중...');

        // 타임코드 업데이트
        subtitleTimecodes = result.timecodes;

        // UI 업데이트
        subtitleTimecodes.forEach((tc, index) => {
            const row = document.getElementById(`subtitle-sentence-${index}`);
            if (row) {
                const startInput = row.querySelector('.timecode-start');
                const endInput = row.querySelector('.timecode-end');
                if (startInput) startInput.value = tc.start;
                if (endInput) endInput.value = tc.end;
            }
        });

        // 히스토리 저장
        saveSubtitleHistory();

        updateProgress(100, '타임코드 생성 완료!');

        // 내보내기 버튼 활성화
        elements.exportBtn.disabled = false;

        // 자막 탭으로 전환
        switchTab('subtitle');

    } catch (error) {
        console.error('타임코드 생성 실패:', error);
        updateProgress(0, '타임코드 생성 실패');
        alert('타임코드 생성 실패: ' + error.message);
    }

    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
    }, 2000);
}

// 타임코드 재생성 핸들러
async function handleRegenerateTimecode() {
    // 자막이 있는지 확인
    if (subtitleSentences.length === 0) {
        alert('자막 파일을 먼저 선택해주세요.');
        return;
    }

    // 오디오 파일이 있는지 확인
    if (!externalAudioPath) {
        alert('타임코드 생성을 위한 음성 파일을 먼저 선택해주세요.');
        return;
    }

    // 확인 다이얼로그
    if (!confirm('현재 자막 내용으로 타임코드를 다시 생성합니다.\n계속하시겠습니까?')) {
        return;
    }

    // 타임코드 재생성
    await generateTimecodeFromExternalAudio();
}

// 파일을 텍스트로 읽기
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('파일 읽기 실패'));
        reader.readAsText(file, 'UTF-8');
    });
}

// 문장 분리 (문장부호 기준)
function splitIntoSentences(text) {
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\n\s*\n/g, '<<BREAK>>');
    text = text.replace(/\n/g, ' ');
    text = text.replace(/([.?!。？！])\s*/g, '$1<<SPLIT>>');
    text = text.replace(/<<BREAK>>/g, '<<SPLIT>>');

    const result = text
        .split('<<SPLIT>>')
        .map(s => s.trim())
        .filter(s => s.length > 0);

    return result;
}

// 음성 탭 문장 렌더링 (타임코드 없음)
function renderVoiceSentences() {
    elements.voiceContainer.innerHTML = '';

    if (voiceSentences.length === 0) {
        elements.voiceContainer.innerHTML = `
            <div class="empty-state">
                <p>대본 파일을 선택하면 문장별로 TTS 변환이 시작됩니다.</p>
            </div>
        `;
        return;
    }

    voiceSentences.forEach((clip, index) => {
        const row = document.createElement('div');
        row.className = 'sentence-row';
        row.id = `voice-sentence-${clip.id}`;
        row.dataset.clipId = clip.id;

        // 오디오 파일 존재 여부로 상태 결정
        const hasAudio = audioFiles[clip.id] != null;
        const statusText = hasAudio ? '완료' : '대기중';
        const statusClass = hasAudio ? 'status-done' : '';

        // 선택된 클립 표시
        const isSelected = selectedClipIndex === index;

        row.innerHTML = `
            <span class="sentence-number ${isSelected ? 'selected' : ''}" data-index="${index}" title="클릭하여 선택 (전체 듣기 시작점)">${String(index + 1).padStart(3, '0')}</span>
            <span class="sentence-text" data-clip-id="${clip.id}" data-index="${index}" title="클릭하여 수정">${escapeHtml(clip.text)}</span>
            <div class="sentence-actions">
                <button class="btn btn-small btn-edit" data-clip-id="${clip.id}" data-index="${index}" title="TTS 재생성">🔄</button>
                <button class="btn btn-small btn-play" data-clip-id="${clip.id}" data-index="${index}" ${hasAudio ? '' : 'disabled'} title="듣기">▶</button>
                <button class="btn btn-small btn-download" data-clip-id="${clip.id}" data-index="${index}" ${hasAudio ? '' : 'disabled'} title="다운로드">💾</button>
                <span class="sentence-status ${statusClass}">${statusText}</span>
            </div>
        `;

        elements.voiceContainer.appendChild(row);
    });

    // 클립 번호 클릭 시 해당 지점부터 연속 재생
    elements.voiceContainer.querySelectorAll('.sentence-number').forEach(el => {
        el.addEventListener('click', (e) => playFromClip(parseInt(e.target.dataset.index)));
    });

    // 문장 텍스트 클릭 시 수정 모드
    elements.voiceContainer.querySelectorAll('.sentence-text').forEach(el => {
        el.addEventListener('click', (e) => enableVoiceEditMode(e.target.dataset.clipId, parseInt(e.target.dataset.index)));
    });

    // 버튼 이벤트 연결
    elements.voiceContainer.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => regenerateSentence(e.target.dataset.clipId, parseInt(e.target.dataset.index)));
    });

    elements.voiceContainer.querySelectorAll('.btn-play').forEach(btn => {
        btn.addEventListener('click', (e) => playSentence(e.target.dataset.clipId, parseInt(e.target.dataset.index)));
    });

    elements.voiceContainer.querySelectorAll('.btn-download').forEach(btn => {
        btn.addEventListener('click', (e) => downloadSentence(e.target.dataset.clipId, parseInt(e.target.dataset.index)));
    });
}

// 자막 탭 문장 렌더링 (타임코드 포함)
function renderSubtitleSentences() {
    elements.subtitleContainer.innerHTML = '';

    if (subtitleSentences.length === 0) {
        elements.subtitleContainer.innerHTML = `
            <div class="empty-state">
                <p>자막 파일이 없습니다. (파일명_자막.txt)</p>
            </div>
        `;
        return;
    }

    subtitleSentences.forEach((sentence, index) => {
        const row = document.createElement('div');
        row.className = 'sentence-row with-timecode';
        row.id = `subtitle-sentence-${index}`;

        const tc = subtitleTimecodes[index] || { start: '00:00:00,000', end: '00:00:00,000' };

        row.innerHTML = `
            <span class="sentence-number">${String(index + 1).padStart(3, '0')}</span>
            <div class="sentence-timecode">
                <input type="text" class="timecode-input timecode-start" data-index="${index}"
                       value="${tc.start}" placeholder="00:00:00,000" title="시작 시간">
                <span class="timecode-separator">→</span>
                <input type="text" class="timecode-input timecode-end" data-index="${index}"
                       value="${tc.end}" placeholder="00:00:00,000" title="종료 시간">
            </div>
            <span class="sentence-text" data-index="${index}" title="클릭하여 수정">${escapeHtml(sentence)}</span>
            <div class="sentence-actions">
                <span class="sentence-status">편집가능</span>
            </div>
        `;

        elements.subtitleContainer.appendChild(row);
    });

    // 타임코드 입력 이벤트
    elements.subtitleContainer.querySelectorAll('.timecode-start').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            if (!subtitleTimecodes[idx]) subtitleTimecodes[idx] = { start: '', end: '' };
            subtitleTimecodes[idx].start = e.target.value;
        });
        input.addEventListener('blur', (e) => formatTimecodeInput(e.target));
    });

    elements.subtitleContainer.querySelectorAll('.timecode-end').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index);
            if (!subtitleTimecodes[idx]) subtitleTimecodes[idx] = { start: '', end: '' };
            subtitleTimecodes[idx].end = e.target.value;
        });
        input.addEventListener('blur', (e) => formatTimecodeInput(e.target));
    });

    // 문장 텍스트 클릭 시 수정 모드
    elements.subtitleContainer.querySelectorAll('.sentence-text').forEach(el => {
        el.addEventListener('click', (e) => enableSubtitleEditMode(parseInt(e.target.dataset.index)));
    });

}

// 음성 탭 문장 수정 모드 활성화
function enableVoiceEditMode(clipId, index, cursorPosition = null) {
    const row = document.getElementById(`voice-sentence-${clipId}`);
    if (!row) return;

    const textEl = row.querySelector('.sentence-text');
    const clip = voiceSentences[index];
    if (!clip) return;

    if (textEl.querySelector('input')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sentence-input';
    input.value = clip.text;
    input.dataset.clipId = clipId;
    input.dataset.index = index;

    textEl.innerHTML = '';
    textEl.appendChild(input);
    input.focus();

    // 커서 위치 설정
    if (cursorPosition === 'start') {
        input.setSelectionRange(0, 0);
    } else if (cursorPosition === 'end') {
        input.setSelectionRange(input.value.length, input.value.length);
    } else if (typeof cursorPosition === 'number') {
        input.setSelectionRange(cursorPosition, cursorPosition);
    } else {
        input.select();
    }

    input.addEventListener('keydown', (e) => handleVoiceInputKeydown(e, clipId, index, input));

    input.addEventListener('blur', () => {
        // 병합/분할 중에는 blur 이벤트 무시
        if (isMerging || isSplitting) return;
        // clipId가 배열에 없으면 (split으로 제거된 경우) 무시
        if (!voiceSentences.some(c => c.id === clipId)) return;
        saveVoiceSentenceEdit(clipId, index, input.value);
    });
}

// 음성 탭 입력 키보드 이벤트 처리
function handleVoiceInputKeydown(e, clipId, index, input) {
    const cursorPos = input.selectionStart;
    const cursorEnd = input.selectionEnd;
    const textLength = input.value.length;

    if (e.key === 'Enter') {
        e.preventDefault();
        // 커서 위치에서 클립 나누기
        if (cursorPos > 0 && cursorPos < textLength) {
            splitVoiceClip(clipId, index, cursorPos);
        } else {
            saveVoiceSentenceEdit(clipId, index, input.value);
        }
    } else if (e.key === 'Escape') {
        cancelVoiceSentenceEdit(clipId, index);
    } else if (e.key === 'Backspace' && cursorPos === 0 && cursorEnd === 0 && index > 0) {
        // 맨앞에서 Backspace: 앞 클립과 합치기
        e.preventDefault();
        mergeVoiceClipWithPrevious(clipId, index);
    } else if (e.key === 'Delete' && cursorPos === textLength && index < voiceSentences.length - 1) {
        // 맨끝에서 Delete: 뒤 클립과 합치기
        e.preventDefault();
        mergeVoiceClipWithNext(clipId, index);
    } else if (e.key === 'ArrowUp' && index > 0) {
        // 위쪽 화살표: 이전 클립으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(clipId, index, input.value);
        const prevClip = voiceSentences[index - 1];
        setTimeout(() => enableVoiceEditMode(prevClip.id, index - 1, 'end'), 10);
    } else if (e.key === 'ArrowDown' && index < voiceSentences.length - 1) {
        // 아래쪽 화살표: 다음 클립으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(clipId, index, input.value);
        const nextClip = voiceSentences[index + 1];
        setTimeout(() => enableVoiceEditMode(nextClip.id, index + 1, 'start'), 10);
    } else if (e.key === 'ArrowLeft' && cursorPos === 0 && cursorEnd === 0 && index > 0) {
        // 맨앞에서 왼쪽 화살표: 이전 클립 끝으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(clipId, index, input.value);
        const prevClip = voiceSentences[index - 1];
        setTimeout(() => enableVoiceEditMode(prevClip.id, index - 1, 'end'), 10);
    } else if (e.key === 'ArrowRight' && cursorPos === textLength && index < voiceSentences.length - 1) {
        // 맨끝에서 오른쪽 화살표: 다음 클립 시작으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(clipId, index, input.value);
        const nextClip = voiceSentences[index + 1];
        setTimeout(() => enableVoiceEditMode(nextClip.id, index + 1, 'start'), 10);
    }
}

// 음성 클립 나누기
function splitVoiceClip(clipId, index, cursorPos) {
    const clip = voiceSentences[index];
    if (!clip || clip.id !== clipId) return;

    isSplitting = true;

    const input = document.querySelector(`#voice-sentence-${clipId} .sentence-input`);
    const newText = input ? input.value : clip.text;

    const firstPart = newText.substring(0, cursorPos).trim();
    const secondPart = newText.substring(cursorPos).trim();

    if (!firstPart || !secondPart) {
        isSplitting = false;
        return;
    }

    // 히스토리 저장 (변경 전)
    saveVoiceHistory();

    // 새 클립 객체 생성
    const firstClip = { id: generateClipId(), text: firstPart };
    const secondClip = { id: generateClipId(), text: secondPart };

    // 배열 업데이트 (기존 클립을 두 개의 새 클립으로 교체)
    voiceSentences.splice(index, 1, firstClip, secondClip);

    // 기존 클립의 오디오 파일/캐시 삭제 (분할된 클립은 재생성 필요)
    delete audioFiles[clipId];
    delete audioDurations[clipId];
    removeFromAudioCache(clipId);
    updateTotalDuration();

    // UI 재렌더링
    renderVoiceSentences();

    // 두번째 클립 편집 모드로
    setTimeout(() => {
        isSplitting = false;
        enableVoiceEditMode(secondClip.id, index + 1, 'start');
    }, 10);
}

// 음성 클립 앞 클립과 합치기
function mergeVoiceClipWithPrevious(clipId, index) {
    if (index <= 0) return;

    isMerging = true;

    // 히스토리 저장 (변경 전)
    saveVoiceHistory();

    const currentClip = voiceSentences[index];
    const prevClip = voiceSentences[index - 1];

    const input = document.querySelector(`#voice-sentence-${clipId} .sentence-input`);
    const currentText = input ? input.value.trim() : currentClip.text;
    const prevText = prevClip.text;
    const mergedText = prevText + ' ' + currentText;
    const cursorPos = prevText.length + 1; // 합친 지점

    // 새 클립 객체 생성 (합쳐진 클립)
    const mergedClip = { id: generateClipId(), text: mergedText };

    // 배열 업데이트
    voiceSentences.splice(index - 1, 2, mergedClip);

    // 기존 클립들의 오디오 파일/캐시 삭제
    delete audioFiles[prevClip.id];
    delete audioFiles[currentClip.id];
    delete audioDurations[prevClip.id];
    delete audioDurations[currentClip.id];
    removeFromAudioCache(prevClip.id);
    removeFromAudioCache(currentClip.id);
    updateTotalDuration();

    // UI 재렌더링
    renderVoiceSentences();

    // 합쳐진 클립 편집 모드로 (합친 지점에 커서)
    setTimeout(() => {
        isMerging = false;
        enableVoiceEditMode(mergedClip.id, index - 1, cursorPos);
    }, 10);
}

// 음성 클립 뒤 클립과 합치기
function mergeVoiceClipWithNext(clipId, index) {
    if (index >= voiceSentences.length - 1) return;

    isMerging = true;

    // 히스토리 저장 (변경 전)
    saveVoiceHistory();

    const currentClip = voiceSentences[index];
    const nextClip = voiceSentences[index + 1];

    const input = document.querySelector(`#voice-sentence-${clipId} .sentence-input`);
    const currentText = input ? input.value.trim() : currentClip.text;
    const nextText = nextClip.text;
    const mergedText = currentText + ' ' + nextText;
    const cursorPos = currentText.length + 1; // 합친 지점

    // 새 클립 객체 생성 (합쳐진 클립)
    const mergedClip = { id: generateClipId(), text: mergedText };

    // 배열 업데이트
    voiceSentences.splice(index, 2, mergedClip);

    // 기존 클립들의 오디오 파일/캐시 삭제
    delete audioFiles[currentClip.id];
    delete audioFiles[nextClip.id];
    delete audioDurations[currentClip.id];
    delete audioDurations[nextClip.id];
    removeFromAudioCache(currentClip.id);
    removeFromAudioCache(nextClip.id);
    updateTotalDuration();

    // UI 재렌더링
    renderVoiceSentences();

    // 합쳐진 클립 편집 모드로 (합친 지점에 커서)
    setTimeout(() => {
        isMerging = false;
        enableVoiceEditMode(mergedClip.id, index, cursorPos);
    }, 10);
}

// 음성 탭 문장 수정 저장
function saveVoiceSentenceEdit(clipId, index, newText) {
    newText = newText.trim();
    if (!newText) {
        cancelVoiceSentenceEdit(clipId, index);
        return;
    }

    const clip = voiceSentences[index];
    if (!clip) return;

    const oldText = clip.text;

    const row = document.getElementById(`voice-sentence-${clipId}`);
    if (!row) return;
    const textEl = row.querySelector('.sentence-text');
    textEl.innerHTML = escapeHtml(newText);

    if (oldText !== newText) {
        // 히스토리 저장 (변경 전)
        saveVoiceHistory();

        clip.text = newText;
        delete audioFiles[clipId];
        delete audioDurations[clipId];
        removeFromAudioCache(clipId);
        updateTotalDuration();
        updateVoiceSentenceStatus(clipId, '수정됨');
        row.querySelector('.btn-play').disabled = true;
        row.querySelector('.btn-download').disabled = true;
    }
}

// 음성 탭 문장 수정 취소
function cancelVoiceSentenceEdit(clipId, index) {
    const row = document.getElementById(`voice-sentence-${clipId}`);
    if (!row) return;
    const clip = voiceSentences[index];
    if (!clip) return;
    const textEl = row.querySelector('.sentence-text');
    textEl.innerHTML = escapeHtml(clip.text);
}

// 자막 탭 문장 수정 모드 활성화
function enableSubtitleEditMode(index, cursorPosition = null) {
    const row = document.getElementById(`subtitle-sentence-${index}`);
    if (!row) return;

    const textEl = row.querySelector('.sentence-text');
    const currentText = subtitleSentences[index];

    if (textEl.querySelector('input')) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sentence-input';
    input.value = currentText;
    input.dataset.index = index;

    textEl.innerHTML = '';
    textEl.appendChild(input);
    input.focus();

    // 커서 위치 설정
    if (cursorPosition === 'start') {
        input.setSelectionRange(0, 0);
    } else if (cursorPosition === 'end') {
        input.setSelectionRange(input.value.length, input.value.length);
    } else if (typeof cursorPosition === 'number') {
        input.setSelectionRange(cursorPosition, cursorPosition);
    } else {
        input.select();
    }

    input.addEventListener('keydown', (e) => handleSubtitleInputKeydown(e, index, input));

    input.addEventListener('blur', () => {
        // 병합/분할 중에는 blur 이벤트 무시
        if (isMerging || isSplitting) return;
        saveSubtitleSentenceEdit(index, input.value);
    });
}

// 자막 탭 입력 키보드 이벤트 처리
function handleSubtitleInputKeydown(e, index, input) {
    const cursorPos = input.selectionStart;
    const cursorEnd = input.selectionEnd;
    const textLength = input.value.length;

    if (e.key === 'Enter') {
        e.preventDefault();
        // 커서 위치에서 클립 나누기
        if (cursorPos > 0 && cursorPos < textLength) {
            splitSubtitleClip(index, cursorPos);
        } else {
            saveSubtitleSentenceEdit(index, input.value);
        }
    } else if (e.key === 'Escape') {
        cancelSubtitleSentenceEdit(index);
    } else if (e.key === 'Backspace' && cursorPos === 0 && cursorEnd === 0 && index > 0) {
        // 맨앞에서 Backspace: 앞 클립과 합치기
        e.preventDefault();
        mergeSubtitleClipWithPrevious(index);
    } else if (e.key === 'Delete' && cursorPos === textLength && index < subtitleSentences.length - 1) {
        // 맨끝에서 Delete: 뒤 클립과 합치기
        e.preventDefault();
        mergeSubtitleClipWithNext(index);
    } else if (e.key === 'ArrowUp' && index > 0) {
        // 위쪽 화살표: 이전 클립으로 이동
        e.preventDefault();
        saveSubtitleSentenceEdit(index, input.value);
        setTimeout(() => enableSubtitleEditMode(index - 1, 'end'), 10);
    } else if (e.key === 'ArrowDown' && index < subtitleSentences.length - 1) {
        // 아래쪽 화살표: 다음 클립으로 이동
        e.preventDefault();
        saveSubtitleSentenceEdit(index, input.value);
        setTimeout(() => enableSubtitleEditMode(index + 1, 'start'), 10);
    } else if (e.key === 'ArrowLeft' && cursorPos === 0 && cursorEnd === 0 && index > 0) {
        // 맨앞에서 왼쪽 화살표: 이전 클립 끝으로 이동
        e.preventDefault();
        saveSubtitleSentenceEdit(index, input.value);
        setTimeout(() => enableSubtitleEditMode(index - 1, 'end'), 10);
    } else if (e.key === 'ArrowRight' && cursorPos === textLength && index < subtitleSentences.length - 1) {
        // 맨끝에서 오른쪽 화살표: 다음 클립 시작으로 이동
        e.preventDefault();
        saveSubtitleSentenceEdit(index, input.value);
        setTimeout(() => enableSubtitleEditMode(index + 1, 'start'), 10);
    }
}

// 자막 클립 나누기
function splitSubtitleClip(index, cursorPos) {
    isSplitting = true;

    const currentText = subtitleSentences[index];
    const input = document.querySelector(`#subtitle-sentence-${index} .sentence-input`);
    const newText = input ? input.value : currentText;

    const firstPart = newText.substring(0, cursorPos).trim();
    const secondPart = newText.substring(cursorPos).trim();

    if (!firstPart || !secondPart) {
        isSplitting = false;
        return;
    }

    // 히스토리 저장 (변경 전)
    saveSubtitleHistory();

    // 배열 업데이트
    subtitleSentences.splice(index, 1, firstPart, secondPart);

    // 타임코드 배열 업데이트 (새 클립은 빈 타임코드)
    const currentTC = subtitleTimecodes[index] || { start: '00:00:00,000', end: '00:00:00,000' };
    subtitleTimecodes.splice(index, 1,
        { start: currentTC.start, end: '00:00:00,000' },
        { start: '00:00:00,000', end: currentTC.end }
    );

    // UI 재렌더링
    renderSubtitleSentences();

    // 두번째 클립 편집 모드로
    setTimeout(() => {
        isSplitting = false;
        enableSubtitleEditMode(index + 1, 'start');
    }, 10);
}

// 자막 클립 앞 클립과 합치기
function mergeSubtitleClipWithPrevious(index) {
    if (index <= 0) return;

    isMerging = true;

    // 히스토리 저장 (변경 전)
    saveSubtitleHistory();

    const input = document.querySelector(`#subtitle-sentence-${index} .sentence-input`);
    const currentText = input ? input.value.trim() : subtitleSentences[index];
    const prevText = subtitleSentences[index - 1];
    const mergedText = prevText + ' ' + currentText;
    const cursorPos = prevText.length + 1; // 합친 지점

    // 타임코드 병합 (앞 클립의 시작, 뒤 클립의 종료)
    const prevTC = subtitleTimecodes[index - 1] || { start: '00:00:00,000', end: '00:00:00,000' };
    const currTC = subtitleTimecodes[index] || { start: '00:00:00,000', end: '00:00:00,000' };
    const mergedTC = { start: prevTC.start, end: currTC.end };

    // 배열 업데이트
    subtitleSentences.splice(index - 1, 2, mergedText);
    subtitleTimecodes.splice(index - 1, 2, mergedTC);

    // UI 재렌더링
    renderSubtitleSentences();

    // 합쳐진 클립 편집 모드로 (합친 지점에 커서)
    setTimeout(() => {
        isMerging = false;
        enableSubtitleEditMode(index - 1, cursorPos);
    }, 10);
}

// 자막 클립 뒤 클립과 합치기
function mergeSubtitleClipWithNext(index) {
    if (index >= subtitleSentences.length - 1) return;

    isMerging = true;

    // 히스토리 저장 (변경 전)
    saveSubtitleHistory();

    const input = document.querySelector(`#subtitle-sentence-${index} .sentence-input`);
    const currentText = input ? input.value.trim() : subtitleSentences[index];
    const nextText = subtitleSentences[index + 1];
    const mergedText = currentText + ' ' + nextText;
    const cursorPos = currentText.length + 1; // 합친 지점

    // 타임코드 병합 (현재 클립의 시작, 다음 클립의 종료)
    const currTC = subtitleTimecodes[index] || { start: '00:00:00,000', end: '00:00:00,000' };
    const nextTC = subtitleTimecodes[index + 1] || { start: '00:00:00,000', end: '00:00:00,000' };
    const mergedTC = { start: currTC.start, end: nextTC.end };

    // 배열 업데이트
    subtitleSentences.splice(index, 2, mergedText);
    subtitleTimecodes.splice(index, 2, mergedTC);

    // UI 재렌더링
    renderSubtitleSentences();

    // 합쳐진 클립 편집 모드로 (합친 지점에 커서)
    setTimeout(() => {
        isMerging = false;
        enableSubtitleEditMode(index, cursorPos);
    }, 10);
}

// 자막 탭 문장 수정 저장
function saveSubtitleSentenceEdit(index, newText) {
    newText = newText.trim();
    if (!newText) {
        cancelSubtitleSentenceEdit(index);
        return;
    }

    const oldText = subtitleSentences[index];

    const row = document.getElementById(`subtitle-sentence-${index}`);
    const textEl = row.querySelector('.sentence-text');
    textEl.innerHTML = escapeHtml(newText);

    if (oldText !== newText) {
        // 히스토리 저장 (변경 전)
        saveSubtitleHistory();

        subtitleSentences[index] = newText;
    }
}

// 자막 탭 문장 수정 취소
function cancelSubtitleSentenceEdit(index) {
    const row = document.getElementById(`subtitle-sentence-${index}`);
    const textEl = row.querySelector('.sentence-text');
    textEl.innerHTML = escapeHtml(subtitleSentences[index]);
}

// ========== Undo/Redo 기능 ==========

// 음성 탭 히스토리 저장
function saveVoiceHistory() {
    // 현재 위치 이후의 히스토리 삭제 (새 작업 시 redo 히스토리 제거)
    if (voiceHistoryIndex < voiceHistory.length - 1) {
        voiceHistory = voiceHistory.slice(0, voiceHistoryIndex + 1);
    }

    // 현재 상태 저장 (깊은 복사)
    const state = {
        sentences: JSON.parse(JSON.stringify(voiceSentences)),
        audioFiles: JSON.parse(JSON.stringify(audioFiles)),
    };

    voiceHistory.push(state);
    voiceHistoryIndex = voiceHistory.length - 1;

    // 최대 히스토리 수 제한
    if (voiceHistory.length > MAX_HISTORY) {
        voiceHistory.shift();
        voiceHistoryIndex--;
    }

    console.log(`음성 히스토리 저장: ${voiceHistoryIndex + 1}/${voiceHistory.length}`);
}

// 자막 탭 히스토리 저장
function saveSubtitleHistory() {
    // 현재 위치 이후의 히스토리 삭제
    if (subtitleHistoryIndex < subtitleHistory.length - 1) {
        subtitleHistory = subtitleHistory.slice(0, subtitleHistoryIndex + 1);
    }

    // 현재 상태 저장 (깊은 복사)
    const state = {
        sentences: JSON.parse(JSON.stringify(subtitleSentences)),
        timecodes: JSON.parse(JSON.stringify(subtitleTimecodes)),
    };

    subtitleHistory.push(state);
    subtitleHistoryIndex = subtitleHistory.length - 1;

    // 최대 히스토리 수 제한
    if (subtitleHistory.length > MAX_HISTORY) {
        subtitleHistory.shift();
        subtitleHistoryIndex--;
    }

    console.log(`자막 히스토리 저장: ${subtitleHistoryIndex + 1}/${subtitleHistory.length}`);
}

// 음성 탭 Undo
function undoVoice() {
    if (voiceHistoryIndex <= 0) {
        console.log('음성 Undo 불가: 더 이상 되돌릴 히스토리가 없습니다.');
        return false;
    }

    voiceHistoryIndex--;
    const state = voiceHistory[voiceHistoryIndex];

    voiceSentences = JSON.parse(JSON.stringify(state.sentences));
    audioFiles = JSON.parse(JSON.stringify(state.audioFiles));
    audioCache = {}; // 캐시 초기화
    audioCacheOrder = [];

    renderVoiceSentences();
    console.log(`음성 Undo: ${voiceHistoryIndex + 1}/${voiceHistory.length}`);
    return true;
}

// 음성 탭 Redo
function redoVoice() {
    if (voiceHistoryIndex >= voiceHistory.length - 1) {
        console.log('음성 Redo 불가: 더 이상 앞으로 갈 히스토리가 없습니다.');
        return false;
    }

    voiceHistoryIndex++;
    const state = voiceHistory[voiceHistoryIndex];

    voiceSentences = JSON.parse(JSON.stringify(state.sentences));
    audioFiles = JSON.parse(JSON.stringify(state.audioFiles));
    audioCache = {}; // 캐시 초기화
    audioCacheOrder = [];

    renderVoiceSentences();
    console.log(`음성 Redo: ${voiceHistoryIndex + 1}/${voiceHistory.length}`);
    return true;
}

// 자막 탭 Undo
function undoSubtitle() {
    if (subtitleHistoryIndex <= 0) {
        console.log('자막 Undo 불가: 더 이상 되돌릴 히스토리가 없습니다.');
        return false;
    }

    subtitleHistoryIndex--;
    const state = subtitleHistory[subtitleHistoryIndex];

    subtitleSentences = JSON.parse(JSON.stringify(state.sentences));
    subtitleTimecodes = JSON.parse(JSON.stringify(state.timecodes));

    renderSubtitleSentences();
    console.log(`자막 Undo: ${subtitleHistoryIndex + 1}/${subtitleHistory.length}`);
    return true;
}

// 자막 탭 Redo
function redoSubtitle() {
    if (subtitleHistoryIndex >= subtitleHistory.length - 1) {
        console.log('자막 Redo 불가: 더 이상 앞으로 갈 히스토리가 없습니다.');
        return false;
    }

    subtitleHistoryIndex++;
    const state = subtitleHistory[subtitleHistoryIndex];

    subtitleSentences = JSON.parse(JSON.stringify(state.sentences));
    subtitleTimecodes = JSON.parse(JSON.stringify(state.timecodes));

    renderSubtitleSentences();
    console.log(`자막 Redo: ${subtitleHistoryIndex + 1}/${subtitleHistory.length}`);
    return true;
}

// 현재 탭에 따라 Undo 실행
function handleUndo() {
    if (currentTab === 'voice') {
        undoVoice();
    } else {
        undoSubtitle();
    }
}

// 현재 탭에 따라 Redo 실행
function handleRedo() {
    if (currentTab === 'voice') {
        redoVoice();
    } else {
        redoSubtitle();
    }
}

// 음성 탭 히스토리 초기화 (파일 로드 시)
function initVoiceHistory() {
    voiceHistory = [];
    voiceHistoryIndex = -1;
    saveVoiceHistory(); // 초기 상태 저장
}

// 자막 탭 히스토리 초기화 (파일 로드 시)
function initSubtitleHistory() {
    subtitleHistory = [];
    subtitleHistoryIndex = -1;
    saveSubtitleHistory(); // 초기 상태 저장
}

// ========== 초기화 함수 ==========

// 모든 작업 초기화
function resetAll() {
    // 플레이어 중지
    closePlayer();

    // 전역 상태 초기화
    voiceSentences = [];
    subtitleSentences = [];
    audioFiles = {};
    audioDurations = {};
    audioCache = {};
    audioCacheOrder = [];
    clipIdCounter = 0;
    updateTotalDuration();
    subtitleTimecodes = [];
    currentFileName = '';
    currentFilePath = '';
    currentFileDir = '';
    scriptFileName = '';
    subtitleFileName = '';
    externalAudioPath = '';
    externalAudioFileName = '';
    isProcessing = false;
    currentPlayerIndex = 0;
    isPlaying = false;
    globalAudio = null;
    currentTab = 'voice';
    lastExportedFilePath = '';
    isMerging = false;
    isSplitting = false;
    stopRequested = false;
    currentSentenceClipId = null;
    selectedClipIndex = -1;

    // Undo/Redo 히스토리 초기화
    voiceHistory = [];
    voiceHistoryIndex = -1;
    subtitleHistory = [];
    subtitleHistoryIndex = -1;

    // UI 초기화
    // 파일 라벨 초기화
    elements.scriptFileLabel.textContent = '파일 없음';
    elements.scriptFileLabel.classList.remove('has-file');
    elements.subtitleFileLabel.textContent = '파일 없음';
    elements.subtitleFileLabel.classList.remove('has-file');
    elements.audioFileLabel.textContent = '파일 선택';
    elements.audioInputBtn.classList.remove('loaded');

    // 자막 파일 정보 초기화
    elements.subtitleFileInfo.textContent = '';

    // 버튼 비활성화
    elements.playAllBtn.disabled = true;
    elements.exportBtn.disabled = true;

    // 진행 상태 숨기기
    elements.progressSection.classList.add('hidden');
    elements.progressFill.style.width = '0%';
    elements.progressText.textContent = '준비 중...';

    // 내보내기 결과 숨기기
    elements.exportResult.classList.add('hidden');

    // 음성 탭으로 전환
    switchTab('voice');

    // 음성/자막 컨테이너 빈 상태로 렌더링
    renderVoiceSentences();
    renderSubtitleSentences();

    console.log('모든 작업이 초기화되었습니다.');
}

// ========== 중단 함수 ==========

// 중단 함수
function stopProcessing() {
    stopRequested = true;
    updateProgress(0, '중단 중...');
}

// 모든 문장 TTS 변환
async function processAllSentences() {
    if (isProcessing) return;
    isProcessing = true;
    stopRequested = false;

    elements.progressSection.classList.remove('hidden');
    elements.stopBtn.classList.remove('hidden');
    elements.playAllBtn.disabled = true;
    elements.exportBtn.disabled = true;

    const total = voiceSentences.length;

    for (let i = 0; i < total; i++) {
        const clip = voiceSentences[i];

        // 중단 요청 확인
        if (stopRequested) {
            updateProgress(0, '변환이 중단되었습니다.');
            break;
        }

        updateProgress((i / total) * 100, `문장 ${i + 1}/${total} 변환 중...`);
        updateVoiceSentenceStatus(clip.id, '변환중...');

        try {
            const result = await synthesizeSentence(clip.id, i);
            if (result.success) {
                audioFiles[clip.id] = result.filepath;
                if (result.duration) {
                    audioDurations[clip.id] = result.duration;
                }
                updateVoiceSentenceStatus(clip.id, '완료', true);
                updateTotalDuration();
            } else {
                updateVoiceSentenceStatus(clip.id, '실패');
            }
        } catch (error) {
            console.error(`문장 ${i + 1} 변환 실패:`, error);
            updateVoiceSentenceStatus(clip.id, '실패');
        }
    }

    if (!stopRequested) {
        updateProgress(100, '변환 완료!');
    }

    const completedCount = Object.keys(audioFiles).length;
    if (completedCount > 0) {
        elements.playAllBtn.disabled = false;
        elements.exportBtn.disabled = false;
        elements.regenerateAllBtn.disabled = false;
    }

    isProcessing = false;
    stopRequested = false;
    elements.stopBtn.classList.add('hidden');

    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
    }, 2000);
}

// 전체 재생성 (음성 변경 후 모든 문장 다시 TTS)
async function regenerateAllSentences() {
    if (isProcessing) return;
    if (voiceSentences.length === 0) {
        alert('재생성할 문장이 없습니다.');
        return;
    }

    // 확인 메시지
    const voiceName = elements.voice.value;
    if (!confirm(`현재 설정(${voiceName})으로 모든 문장을 다시 생성하시겠습니까?\n\n기존 음성 파일이 새로 생성됩니다.`)) {
        return;
    }

    isProcessing = true;
    stopRequested = false;

    elements.progressSection.classList.remove('hidden');
    elements.stopBtn.classList.remove('hidden');
    elements.playAllBtn.disabled = true;
    elements.exportBtn.disabled = true;
    elements.regenerateAllBtn.disabled = true;

    // 기존 오디오 캐시 초기화
    Object.keys(audioCache).forEach(key => removeFromAudioCache(key));

    const total = voiceSentences.length;

    for (let i = 0; i < total; i++) {
        const clip = voiceSentences[i];

        // 중단 요청 확인
        if (stopRequested) {
            updateProgress(0, '재생성이 중단되었습니다.');
            break;
        }

        updateProgress((i / total) * 100, `문장 ${i + 1}/${total} 재생성 중...`);
        updateVoiceSentenceStatus(clip.id, '변환중...');

        try {
            const result = await synthesizeSentence(clip.id, i);
            if (result.success) {
                audioFiles[clip.id] = result.filepath;
                if (result.duration) {
                    audioDurations[clip.id] = result.duration;
                }
                updateVoiceSentenceStatus(clip.id, '완료', true);
                updateTotalDuration();
            } else {
                updateVoiceSentenceStatus(clip.id, '실패');
            }
        } catch (error) {
            console.error(`문장 ${i + 1} 재생성 실패:`, error);
            updateVoiceSentenceStatus(clip.id, '실패');
        }
    }

    if (!stopRequested) {
        updateProgress(100, '전체 재생성 완료!');
    }

    const completedCount = Object.keys(audioFiles).length;
    if (completedCount > 0) {
        elements.playAllBtn.disabled = false;
        elements.exportBtn.disabled = false;
    }
    elements.regenerateAllBtn.disabled = false;

    isProcessing = false;
    stopRequested = false;
    elements.stopBtn.classList.add('hidden');

    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
    }, 2000);
}

// 단일 문장 TTS 변환
async function synthesizeSentence(clipId, index) {
    const clip = voiceSentences[index];
    if (!clip) return { success: false, message: '클립을 찾을 수 없습니다.' };

    // clipId 해시를 사용한 고유 파일명 (분할/병합해도 충돌 없음)
    const clipHash = clipIdToHash(clipId);
    const outputName = `${currentFileName}_${clipHash}`;

    // 대본 폴더/wav 에 저장
    const wavFolder = currentFileDir ? currentFileDir + '/wav' : null;

    return await eel.synthesize_sentence(
        clip.text,
        elements.language.value,
        elements.voice.value,
        parseFloat(elements.speed.value),
        parseInt(elements.quality.value),
        outputName,
        wavFolder
    )();
}

// 문장 재생성
async function regenerateSentence(clipId, index) {
    if (isProcessing) return;

    const btn = elements.voiceContainer.querySelector(`.btn-edit[data-clip-id="${clipId}"]`);
    if (btn) btn.disabled = true;
    updateVoiceSentenceStatus(clipId, '변환중...');

    try {
        const result = await synthesizeSentence(clipId, index);
        if (result.success) {
            audioFiles[clipId] = result.filepath;
            if (result.duration) {
                audioDurations[clipId] = result.duration;
            }
            removeFromAudioCache(clipId);
            updateVoiceSentenceStatus(clipId, '완료', true);
            updateTotalDuration();
        } else {
            updateVoiceSentenceStatus(clipId, '실패');
        }
    } catch (error) {
        console.error(`문장 ${index + 1} 재생성 실패:`, error);
        updateVoiceSentenceStatus(clipId, '실패');
    }

    if (btn) btn.disabled = false;
}

// 음성 문장 상태 업데이트
function updateVoiceSentenceStatus(clipId, status, enablePlay = false) {
    const row = document.getElementById(`voice-sentence-${clipId}`);
    if (!row) return;

    const statusEl = row.querySelector('.sentence-status');
    const playBtn = row.querySelector('.btn-play');
    const downloadBtn = row.querySelector('.btn-download');

    statusEl.textContent = status;

    if (enablePlay) {
        if (playBtn) playBtn.disabled = false;
        if (downloadBtn) downloadBtn.disabled = false;
    }

    row.classList.remove('processing', 'completed', 'failed');
    if (status === '변환중...') {
        row.classList.add('processing');
    } else if (status === '완료') {
        row.classList.add('completed');
    } else if (status === '실패') {
        row.classList.add('failed');
    }
}

// 플레이어 모드: 'single' (단일 문장) 또는 'all' (전체 듣기)
let playerMode = 'single';

// 단일 문장 재생 (토글 방식: 1번 클릭=재생, 2번 클릭=정지)
async function playSentence(clipId, index) {
    const filepath = audioFiles[clipId];
    if (!filepath) return;

    // 전체 듣기 모드 중이면 먼저 중지
    if (playerMode === 'all' && globalAudio) {
        stopPlayer();
    }

    // 같은 문장을 다시 클릭하면 정지
    if (currentSentenceAudio && currentSentenceClipId === clipId) {
        currentSentenceAudio.pause();
        currentSentenceAudio.currentTime = 0;
        updatePlayButtonState(currentSentenceClipId, false);
        currentSentenceAudio = null;
        currentSentenceClipId = null;
        return;
    }

    // 다른 문장이 재생 중이면 먼저 정지
    if (currentSentenceAudio) {
        currentSentenceAudio.pause();
        currentSentenceAudio.currentTime = 0;
        updatePlayButtonState(currentSentenceClipId, false);
    }

    try {
        if (!audioCache[clipId]) {
            addToAudioCache(clipId, await eel.get_audio_url(filepath)());
        }

        currentSentenceAudio = new Audio(audioCache[clipId]);
        currentSentenceAudio.playbackRate = 1.0;  // 문장 재생은 항상 정상 속도
        currentSentenceClipId = clipId;

        // 재생 버튼 상태 업데이트
        updatePlayButtonState(clipId, true);

        // 재생 완료 시 상태 초기화
        currentSentenceAudio.onended = () => {
            updatePlayButtonState(currentSentenceClipId, false);
            currentSentenceAudio = null;
            currentSentenceClipId = null;
        };

        currentSentenceAudio.play();
    } catch (error) {
        console.error('재생 실패:', error);
        currentSentenceAudio = null;
        currentSentenceClipId = null;
    }
}

// 재생 버튼 상태 업데이트 (재생 중이면 ■, 아니면 ▶)
function updatePlayButtonState(clipId, isPlaying) {
    const btn = elements.voiceContainer.querySelector(`.btn-play[data-clip-id="${clipId}"]`);
    if (btn) {
        btn.textContent = isPlaying ? '■' : '▶';
        btn.title = isPlaying ? '정지' : '재생';
        if (isPlaying) {
            btn.classList.add('playing');
        } else {
            btn.classList.remove('playing');
        }
    }
}

// 단일 문장 다운로드
async function downloadSentence(clipId, index) {
    const filepath = audioFiles[clipId];
    if (!filepath) return;

    try {
        if (!audioCache[clipId]) {
            addToAudioCache(clipId, await eel.get_audio_url(filepath)());
        }

        const filename = `${currentFileName}_${clipIdToHash(clipId)}.wav`;

        const link = document.createElement('a');
        link.href = audioCache[clipId];
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('다운로드 실패:', error);
        alert('다운로드에 실패했습니다.');
    }
}

// 인라인 플레이어 표시
function showInlinePlayer(mode, index = 0) {
    playerMode = mode;
    elements.inlinePlayer.classList.remove('hidden');

    if (mode === 'single') {
        // 단일 모드: 이전/다음 버튼 숨김, 상태 표시 변경
        elements.playerPrev.style.display = 'none';
        elements.playerNext.style.display = 'none';
        const clip = voiceSentences[index];
        elements.playerStatus.textContent = `${index + 1}번`;
    } else {
        // 전체 모드: 이전/다음 버튼 표시
        elements.playerPrev.style.display = '';
        elements.playerNext.style.display = '';
        updatePlayerStatus();
    }
}

// 인라인 플레이어 숨김
function hideInlinePlayer() {
    elements.inlinePlayer.classList.add('hidden');
    elements.playerProgressBar.style.width = '0%';
    // 총 재생 시간 표시
    const totalSeconds = getTotalDuration();
    elements.playerTime.textContent = totalSeconds > 0 ? `총 ${formatTime(totalSeconds)}` : '0:00 / 0:00';
}

// 시간 포맷 (초 → M:SS)
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// 플레이어 시간 표시 (현재/클립 + 총 시간)
function formatPlayerTime(current, clipDuration) {
    const totalSeconds = getTotalDuration();
    let timeText = `${formatTime(current)} / ${formatTime(clipDuration)}`;
    if (totalSeconds > 0) {
        timeText += ` (총 ${formatTime(totalSeconds)})`;
    }
    return timeText;
}

// 전체 재생 시간 계산
function getTotalDuration() {
    let totalSeconds = 0;
    for (const clipId in audioDurations) {
        totalSeconds += audioDurations[clipId] || 0;
    }
    return totalSeconds;
}

// 전체 재생 시간 표시 (플레이어 타임 영역에)
function updateTotalDuration() {
    const totalSeconds = getTotalDuration();

    // 재생 중이 아닐 때만 플레이어 타임에 총 시간 표시
    if (!isPlaying && elements.playerTime) {
        if (totalSeconds > 0) {
            elements.playerTime.textContent = `총 ${formatTime(totalSeconds)}`;
        } else {
            elements.playerTime.textContent = '0:00 / 0:00';
        }
    }
}

// 프로그레스바 클릭으로 위치 이동
function seekToPosition(e) {
    const rect = elements.playerProgressContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percent = Math.max(0, Math.min(1, clickX / width));

    // 현재 재생 중인 오디오 객체 찾기
    const audio = playerMode === 'single' ? currentSentenceAudio : globalAudio;
    if (audio && audio.duration) {
        audio.currentTime = audio.duration * percent;
    }
}

// 클립 번호 클릭 - 해당 지점부터 끝까지 연속 재생
function playFromClip(index) {
    // TTS 처리 중에는 재생 불가
    if (isProcessing) {
        console.log('TTS 처리 중에는 재생할 수 없습니다.');
        return;
    }

    // 클립 유효성 확인
    if (index < 0 || index >= voiceSentences.length) return;

    // 해당 위치부터 오디오가 있는 클립이 있는지 확인
    let hasAudioFromIndex = false;
    for (let i = index; i < voiceSentences.length; i++) {
        const clip = voiceSentences[i];
        if (audioFiles[clip.id]) {
            hasAudioFromIndex = true;
            break;
        }
    }

    if (!hasAudioFromIndex) {
        console.log('해당 위치부터 재생할 오디오가 없습니다.');
        alert('해당 위치부터 재생할 오디오가 없습니다.');
        return;
    }

    // 현재 재생 중이면 중지
    stopPlayer();

    // 단일 문장 재생 중이면 중지
    if (currentSentenceAudio) {
        currentSentenceAudio.pause();
        updatePlayButtonState(currentSentenceClipId, false);
        currentSentenceAudio = null;
        currentSentenceClipId = null;
    }

    // 선택 상태 시각적 업데이트
    selectedClipIndex = index;
    elements.voiceContainer.querySelectorAll('.sentence-number').forEach((el, i) => {
        el.classList.toggle('selected', i === selectedClipIndex);
    });

    // 해당 클립부터 연속 재생 시작
    currentPlayerIndex = index;
    isPlaying = true;
    playerMode = 'all';

    showInlinePlayer('all');
    elements.playerPlay.textContent = '⏸';

    console.log(`${index + 1}번 클립부터 연속 재생 시작`);
    playCurrentTrack();
}

// 전체 듣기 시작 (처음부터)
function startPlayAll() {
    // 단일 재생 중이면 먼저 중지
    if (currentSentenceAudio) {
        currentSentenceAudio.pause();
        updatePlayButtonState(currentSentenceClipId, false);
        currentSentenceAudio = null;
        currentSentenceClipId = null;
    }

    // voiceSentences 순서대로 오디오 파일이 있는지 확인
    const hasAudio = voiceSentences.some(clip => audioFiles[clip.id] != null);
    if (!hasAudio) return;

    // 항상 처음부터 시작
    selectedClipIndex = -1;
    elements.voiceContainer.querySelectorAll('.sentence-number').forEach(el => {
        el.classList.remove('selected');
    });

    currentPlayerIndex = 0;
    isPlaying = true;
    playerMode = 'all';

    showInlinePlayer('all');
    elements.playerPlay.textContent = '⏸';

    playCurrentTrack();
}

// 현재 트랙 재생
async function playCurrentTrack() {
    if (currentPlayerIndex >= voiceSentences.length) {
        stopPlayer();
        return;
    }

    // 오디오가 있는 다음 클립 찾기
    while (currentPlayerIndex < voiceSentences.length) {
        const clip = voiceSentences[currentPlayerIndex];
        if (audioFiles[clip.id] != null) break;
        currentPlayerIndex++;
    }

    if (currentPlayerIndex >= voiceSentences.length) {
        stopPlayer();
        return;
    }

    const currentClip = voiceSentences[currentPlayerIndex];
    const clipId = currentClip.id;

    updatePlayerStatus();
    highlightCurrentSentence(clipId);

    try {
        if (!audioCache[clipId]) {
            addToAudioCache(clipId, await eel.get_audio_url(audioFiles[clipId])());
        }

        if (globalAudio) {
            globalAudio.pause();
        }

        globalAudio = new Audio(audioCache[clipId]);
        globalAudio.playbackRate = parseFloat(elements.playerSpeedSelect.value);

        globalAudio.onended = () => {
            if (isPlaying) {
                currentPlayerIndex++;
                // 클립 사이 무음 간격
                setTimeout(() => {
                    playCurrentTrack();
                }, CLIP_GAP_MS);
            }
        };

        globalAudio.ontimeupdate = () => {
            if (globalAudio && globalAudio.duration) {
                const progress = (globalAudio.currentTime / globalAudio.duration) * 100;
                elements.playerProgressBar.style.width = `${progress}%`;
                elements.playerTime.textContent = formatPlayerTime(globalAudio.currentTime, globalAudio.duration);
            }
        };

        globalAudio.play();

    } catch (error) {
        console.error('재생 실패:', error);
        currentPlayerIndex++;
        if (isPlaying) playCurrentTrack();
    }
}

// 플레이어 상태 업데이트
function updatePlayerStatus() {
    // 전체 오디오 파일 수
    const total = voiceSentences.filter(clip => audioFiles[clip.id] != null).length;
    // 현재까지의 오디오 파일 수
    const current = voiceSentences.slice(0, currentPlayerIndex + 1).filter(clip => audioFiles[clip.id] != null).length;
    elements.playerStatus.textContent = `${current} / ${total}`;
}

// 현재 문장 하이라이트
function highlightCurrentSentence(clipId) {
    document.querySelectorAll('.sentence-row').forEach(row => {
        row.classList.remove('playing');
    });

    // clipId가 없으면 currentPlayerIndex로 클립 찾기
    if (!clipId && voiceSentences[currentPlayerIndex]) {
        clipId = voiceSentences[currentPlayerIndex].id;
    }

    const currentRow = document.getElementById(`voice-sentence-${clipId}`);
    if (currentRow) {
        currentRow.classList.add('playing');
        currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 플레이어 컨트롤
function playerPrev() {
    if (currentPlayerIndex > 0) {
        currentPlayerIndex--;
        // 오디오가 있는 이전 클립 찾기
        while (currentPlayerIndex > 0) {
            const clip = voiceSentences[currentPlayerIndex];
            if (audioFiles[clip.id] != null) break;
            currentPlayerIndex--;
        }
        if (isPlaying) playCurrentTrack();
        else {
            updatePlayerStatus();
            highlightCurrentSentence();
        }
    }
}

function playerNext() {
    if (currentPlayerIndex < voiceSentences.length - 1) {
        currentPlayerIndex++;
        // 오디오가 있는 다음 클립 찾기
        while (currentPlayerIndex < voiceSentences.length - 1) {
            const clip = voiceSentences[currentPlayerIndex];
            if (audioFiles[clip.id] != null) break;
            currentPlayerIndex++;
        }
        if (isPlaying) playCurrentTrack();
        else {
            updatePlayerStatus();
            highlightCurrentSentence();
        }
    }
}

function playerToggle() {
    if (playerMode === 'single') {
        // 단일 모드
        if (currentSentenceAudio) {
            if (currentSentenceAudio.paused) {
                currentSentenceAudio.play();
                elements.playerPlay.textContent = '⏸';
            } else {
                currentSentenceAudio.pause();
                elements.playerPlay.textContent = '▶';
            }
        }
    } else {
        // 전체 모드
        if (isPlaying) {
            isPlaying = false;
            elements.playerPlay.textContent = '▶';
            if (globalAudio) globalAudio.pause();
        } else {
            isPlaying = true;
            elements.playerPlay.textContent = '⏸';
            if (globalAudio) globalAudio.play();
            else playCurrentTrack();
        }
    }
}

function stopPlayer() {
    isPlaying = false;
    elements.playerPlay.textContent = '▶';

    if (playerMode === 'single' && currentSentenceAudio) {
        currentSentenceAudio.pause();
        currentSentenceAudio.currentTime = 0;
        updatePlayButtonState(currentSentenceClipId, false);
        currentSentenceAudio = null;
        currentSentenceClipId = null;
    }

    if (globalAudio) {
        globalAudio.pause();
        globalAudio = null;
    }

    elements.playerProgressBar.style.width = '0%';
    // 총 재생 시간 표시
    const totalSeconds = getTotalDuration();
    elements.playerTime.textContent = totalSeconds > 0 ? `총 ${formatTime(totalSeconds)}` : '0:00 / 0:00';
    document.querySelectorAll('.sentence-row').forEach(row => {
        row.classList.remove('playing');
    });
}

function closePlayer() {
    stopPlayer();
    hideInlinePlayer();
}

function updatePlayerSpeed() {
    const speed = parseFloat(elements.playerSpeedSelect.value);
    if (globalAudio) {
        globalAudio.playbackRate = speed;
    }
    // 문장 재생은 항상 정상 속도 유지 (배속 적용 안함)
}

// 내보내기 (파일 병합)
async function exportMergedAudio() {
    // voiceSentences 순서대로 오디오 파일 경로 수집
    const validFiles = voiceSentences
        .map(clip => audioFiles[clip.id])
        .filter(f => f != null);

    if (validFiles.length === 0) {
        alert('내보낼 파일이 없습니다.');
        return;
    }

    elements.exportBtn.disabled = true;
    elements.progressSection.classList.remove('hidden');
    updateProgress(0, '파일 병합 중...');

    try {
        // 대본 폴더/wav 에 저장, 대본 파일명으로 저장
        const wavFolder = currentFileDir ? currentFileDir + '/wav' : null;
        const outputName = scriptFileName || currentFileName;
        const result = await eel.export_merged_audio(validFiles, outputName, wavFolder)();

        if (result.success) {
            updateProgress(100, '내보내기 완료!');
            lastExportedFilePath = result.filepath;
            elements.exportResult.classList.remove('hidden');
            elements.exportMessage.textContent = `✅ ${result.message}`;
            elements.exportMessage.style.color = '#4CAF50';
        } else {
            updateProgress(0, '내보내기 실패');
            elements.exportResult.classList.remove('hidden');
            elements.exportMessage.textContent = `❌ ${result.message}`;
            elements.exportMessage.style.color = '#ff6b6b';
        }
    } catch (error) {
        console.error('내보내기 실패:', error);
        updateProgress(0, '내보내기 실패');
    }

    elements.exportBtn.disabled = false;

    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
    }, 2000);
}

// 내보내기 드롭다운 토글
function toggleExportMenu(e) {
    e.stopPropagation();
    elements.exportMenu.classList.toggle('hidden');
}

function hideExportMenu() {
    elements.exportMenu.classList.add('hidden');
}

// Vrew 프로젝트 내보내기
async function exportVrewProject() {
    // voiceSentences 순서대로 오디오 파일 경로 수집
    const validFiles = voiceSentences
        .map(clip => audioFiles[clip.id])
        .filter(f => f != null);
    const hasGeneratedAudio = validFiles.length > 0;
    const hasExternalAudio = externalAudioPath && externalAudioPath.length > 0;

    // 대본 파일이 있는 폴더 기준으로 하위 폴더에 저장
    const baseFolder = currentFileDir || 'outputs';
    const wavFolder = baseFolder + '/wav';   // WAV 파일 저장 폴더
    const vrewFolder = baseFolder + '/vrew'; // Vrew 파일 저장 폴더

    // WAV 파일명은 대본 파일명 사용
    const wavFileName = scriptFileName || currentFileName;

    console.log('Vrew 내보내기 - 상태 확인:', {
        scriptFileName,
        currentFileName,
        wavFileName,
        wavFolder,
        hasGeneratedAudio,
        hasExternalAudio,
        validFilesCount: validFiles.length
    });

    // 기존 병합 WAV 파일 확인
    const existingWav = await eel.check_merged_wav_exists(wavFileName, wavFolder)();
    const hasExistingMergedWav = existingWav.exists;
    console.log('기존 WAV 파일 확인:', existingWav);

    // 음성 파일 확인 (TTS 생성, 외부 파일, 또는 기존 병합 파일)
    if (!hasGeneratedAudio && !hasExternalAudio && !hasExistingMergedWav) {
        alert('음성 파일이 없습니다.\nTTS 변환을 진행하거나 외부 오디오 파일을 선택해주세요.\n또는 먼저 WAV 내보내기를 실행해주세요.');
        return;
    }

    if (subtitleSentences.length === 0) {
        alert('자막 파일을 먼저 선택해주세요.');
        return;
    }

    elements.exportBtn.disabled = true;
    elements.progressSection.classList.remove('hidden');

    try {
        let audioFilePath = '';

        // 외부 오디오 파일이 있으면 우선 사용
        if (hasExternalAudio) {
            updateProgress(10, '외부 오디오 파일 사용...');
            audioFilePath = externalAudioPath;

            // 타임코드가 아직 생성되지 않았으면 생성
            const hasTimecodes = subtitleTimecodes.some(tc => tc.start !== '00:00:00,000' || tc.end !== '00:00:00,000');
            if (!hasTimecodes) {
                updateProgress(20, 'Whisper 분석 중...');
                const whisperResult = await eel.analyze_external_audio(
                    externalAudioPath,
                    subtitleSentences,
                    elements.language.value
                )();

                if (!whisperResult.success) {
                    throw new Error(whisperResult.message);
                }
                subtitleTimecodes = whisperResult.timecodes;
            }
        } else if (hasGeneratedAudio) {
            // TTS 생성된 파일이 있으면 병합 시도
            updateProgress(0, '음성 파일 병합 중...');
            const mergeResult = await eel.export_merged_audio(validFiles, wavFileName, wavFolder)();

            if (!mergeResult.success) {
                // 병합 실패 시 (파일이 삭제된 경우) 기존 병합 WAV 확인
                if (hasExistingMergedWav) {
                    console.log('문장별 파일 없음, 기존 병합 WAV 파일 사용:', existingWav.filepath);
                    audioFilePath = existingWav.filepath;
                } else {
                    throw new Error(mergeResult.message);
                }
            } else {
                audioFilePath = mergeResult.filepath;
            }

            updateProgress(30, 'Whisper 분석 중...');

            // Whisper 분석으로 타임코드 생성
            const whisperResult = await eel.generate_subtitle_timecodes(
                audioFilePath,
                subtitleSentences
            )();

            if (!whisperResult.success) {
                throw new Error(whisperResult.message);
            }

            subtitleTimecodes = whisperResult.timecodes;
        } else if (hasExistingMergedWav) {
            // 기존 병합 WAV 파일만 있는 경우
            updateProgress(10, '기존 WAV 파일 사용...');
            audioFilePath = existingWav.filepath;
            console.log('기존 병합 WAV 파일 재사용:', audioFilePath);

            // 타임코드가 아직 생성되지 않았으면 생성
            const hasTimecodes = subtitleTimecodes.some(tc => tc.start !== '00:00:00,000' || tc.end !== '00:00:00,000');
            if (!hasTimecodes) {
                updateProgress(20, 'Whisper 분석 중...');
                const whisperResult = await eel.generate_subtitle_timecodes(
                    audioFilePath,
                    subtitleSentences
                )();

                if (!whisperResult.success) {
                    throw new Error(whisperResult.message);
                }
                subtitleTimecodes = whisperResult.timecodes;
            }
        }

        // UI 업데이트
        subtitleTimecodes.forEach((tc, index) => {
            const row = document.getElementById(`subtitle-sentence-${index}`);
            if (row) {
                const startInput = row.querySelector('.timecode-start');
                const endInput = row.querySelector('.timecode-end');
                if (startInput) startInput.value = tc.start;
                if (endInput) endInput.value = tc.end;
            }
        });

        updateProgress(70, 'Vrew 프로젝트 생성 중...');

        // Vrew 파일 생성 (vrew 폴더에 저장)
        const vrewResult = await eel.export_vrew_file(
            currentFileName,
            audioFilePath,
            subtitleSentences,
            subtitleTimecodes,
            vrewFolder
        )();

        if (!vrewResult.success) {
            throw new Error(vrewResult.message);
        }

        updateProgress(100, 'Vrew 프로젝트 생성 완료!');
        lastExportedFilePath = vrewResult.filepath;
        elements.exportResult.classList.remove('hidden');
        elements.exportMessage.textContent = `✅ Vrew 프로젝트 저장 완료!\n${vrewResult.filepath}\n\nVrew에서 열어 편집하세요.`;
        elements.exportMessage.style.color = '#4CAF50';

    } catch (error) {
        console.error('Vrew 내보내기 실패:', error);
        updateProgress(0, 'Vrew 내보내기 실패');
        elements.exportResult.classList.remove('hidden');
        elements.exportMessage.textContent = `❌ ${error.message}`;
        elements.exportMessage.style.color = '#ff6b6b';
    }

    elements.exportBtn.disabled = false;

    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
    }, 2000);
}

// 진행률 업데이트 (Python에서 호출)
eel.expose(updateProgress);
function updateProgress(percent, message) {
    elements.progressFill.style.width = percent + '%';
    elements.progressText.textContent = message;
}

// HTML 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 타임코드 입력 포맷팅
function formatTimecodeInput(input) {
    let value = input.value.trim();
    if (!value) return;

    value = value.replace(/[^0-9:,.]/g, '');

    const parts = value.split(/[:,.]/);

    let hours = 0, minutes = 0, seconds = 0, milliseconds = 0;

    if (parts.length === 1) {
        seconds = parseInt(parts[0]) || 0;
    } else if (parts.length === 2) {
        if (value.includes(',') || value.includes('.')) {
            seconds = parseInt(parts[0]) || 0;
            milliseconds = parseInt(parts[1].padEnd(3, '0').slice(0, 3)) || 0;
        } else {
            minutes = parseInt(parts[0]) || 0;
            seconds = parseInt(parts[1]) || 0;
        }
    } else if (parts.length === 3) {
        if (value.includes(',') || value.includes('.')) {
            minutes = parseInt(parts[0]) || 0;
            seconds = parseInt(parts[1]) || 0;
            milliseconds = parseInt(parts[2].padEnd(3, '0').slice(0, 3)) || 0;
        } else {
            hours = parseInt(parts[0]) || 0;
            minutes = parseInt(parts[1]) || 0;
            seconds = parseInt(parts[2]) || 0;
        }
    } else if (parts.length >= 4) {
        hours = parseInt(parts[0]) || 0;
        minutes = parseInt(parts[1]) || 0;
        seconds = parseInt(parts[2]) || 0;
        milliseconds = parseInt(parts[3].padEnd(3, '0').slice(0, 3)) || 0;
    }

    if (seconds >= 60) {
        minutes += Math.floor(seconds / 60);
        seconds = seconds % 60;
    }
    if (minutes >= 60) {
        hours += Math.floor(minutes / 60);
        minutes = minutes % 60;
    }

    const formatted = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
    input.value = formatted;

    const idx = parseInt(input.dataset.index);
    if (!subtitleTimecodes[idx]) subtitleTimecodes[idx] = { start: '', end: '' };
    if (input.classList.contains('timecode-start')) {
        subtitleTimecodes[idx].start = formatted;
    } else {
        subtitleTimecodes[idx].end = formatted;
    }
}
