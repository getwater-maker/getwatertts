/**
 * Supertonic TTS - Sentence-by-Sentence TTS with Subtitle Tab
 */

// 전역 상태
let voiceSentences = [];          // 음성 탭 문장 배열
let subtitleSentences = [];       // 자막 탭 문장 배열
let audioFiles = [];              // 생성된 오디오 파일 경로 배열
let audioCache = {};              // base64 오디오 캐시
let subtitleTimecodes = [];       // 자막 탭 타임코드 배열 [{start: "00:00:00,000", end: "00:00:00,000"}, ...]
let currentFileName = '';         // 현재 파일명 (확장자 제외)
let currentFilePath = '';         // 대본 파일 전체 경로
let currentFileDir = '';          // 대본 파일이 있는 폴더 경로
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
let stopRequested = false;        // 중단 요청 플래그
let currentSentenceAudio = null;  // 단일 문장 재생용 오디오 객체
let currentSentenceIndex = -1;    // 현재 재생 중인 문장 인덱스

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
    elements.scriptFile = document.getElementById('script-file');
    elements.playAllBtn = document.getElementById('play-all-btn');
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

    // 플레이어 관련
    elements.playerSection = document.getElementById('player-section');
    elements.playerPrev = document.getElementById('player-prev');
    elements.playerPlay = document.getElementById('player-play');
    elements.playerNext = document.getElementById('player-next');
    elements.playerStatus = document.getElementById('player-status');
    elements.playerSpeedSelect = document.getElementById('player-speed-select');
    elements.playerClose = document.getElementById('player-close');
    elements.playerProgressBar = document.getElementById('player-progress-bar');
    elements.exportResult = document.getElementById('export-result');
    elements.exportMessage = document.getElementById('export-message');
    elements.openFolderBtn = document.getElementById('open-folder-btn');
    elements.openFileBtn = document.getElementById('open-file-btn');

    // 자막 파일 선택
    elements.subtitleFile = document.getElementById('subtitle-file');
    elements.subtitleInputBtn = document.querySelector('.subtitle-input-btn');
    elements.subtitleFileLabel = document.getElementById('subtitle-file-label');

    // 대본 파일 버튼
    elements.scriptInputBtn = document.querySelector('.file-input-btn:not(.subtitle-input-btn)');
    elements.scriptFileLabel = document.getElementById('script-file-label');

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
}

// 이벤트 리스너 초기화
function initEventListeners() {
    // 대본 파일 선택
    elements.scriptFile.addEventListener('change', handleFileSelect);

    // 자막 파일 선택
    elements.subtitleFile.addEventListener('change', handleSubtitleFileSelect);

    // 오디오 파일 선택 (자막 싱크용) - 버튼 클릭으로 Python 다이얼로그 열기
    elements.audioInputBtn.addEventListener('click', handleAudioFileSelect);

    // 탭 전환
    elements.tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // 전체 듣기
    elements.playAllBtn.addEventListener('click', startPlayAll);

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

// 파일 선택 핸들러
async function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    // 파일명 및 경로 추출
    const fullName = file.name;
    currentFileName = fullName.replace(/\.[^/.]+$/, '');
    currentFilePath = file.path || '';

    // 폴더 경로 추출 (Windows/Unix 호환)
    if (currentFilePath) {
        const lastSep = Math.max(currentFilePath.lastIndexOf('/'), currentFilePath.lastIndexOf('\\'));
        currentFileDir = lastSep > 0 ? currentFilePath.substring(0, lastSep) : '';
    } else {
        currentFileDir = '';
    }

    // 파일명 라벨 업데이트
    elements.scriptFileLabel.textContent = fullName;
    elements.scriptInputBtn.classList.add('loaded');

    const ext = fullName.split('.').pop().toLowerCase();

    try {
        let content = '';

        if (ext === 'txt') {
            content = await readFileAsText(file);
        } else if (ext === 'docx') {
            const filePath = file.path;
            if (!filePath) {
                alert('DOCX 파일은 Chrome/Edge 앱 모드에서만 지원됩니다.');
                return;
            }
            content = await eel.read_text_file_eel(filePath)();
        } else {
            alert('지원하지 않는 파일 형식입니다. TXT 또는 DOCX 파일을 선택해주세요.');
            return;
        }

        if (!content || content.startsWith('지원하지 않는') || content.startsWith('파일 읽기 오류')) {
            alert(content || '파일을 읽을 수 없습니다.');
            return;
        }

        // 음성 탭: 문장 분리
        voiceSentences = splitIntoSentences(content);

        if (voiceSentences.length === 0) {
            alert('파일에 내용이 없습니다.');
            return;
        }

        // 초기화
        audioFiles = new Array(voiceSentences.length).fill(null);
        audioCache = {};

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

// 자막 파일 선택 핸들러
async function handleSubtitleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const content = await readFileAsText(file);

        if (!content || content.trim().length === 0) {
            alert('자막 파일이 비어있습니다.');
            return;
        }

        // 자막 파일 로드 성공
        subtitleFileName = file.name;
        subtitleSentences = content.split('\n').filter(line => line.trim().length > 0);
        subtitleTimecodes = new Array(subtitleSentences.length).fill(null).map(() => ({
            start: '00:00:00,000',
            end: '00:00:00,000'
        }));

        // UI 업데이트
        elements.subtitleFileLabel.textContent = subtitleFileName;
        elements.subtitleInputBtn.classList.add('loaded');
        elements.subtitleFileInfo.textContent = `📄 ${subtitleFileName}`;

        console.log('자막 파일 로드 성공:', subtitleFileName, '문장 수:', subtitleSentences.length);

        // 자막 탭 렌더링
        renderSubtitleSentences();

        // 자막 탭 히스토리 초기화
        initSubtitleHistory();

        // 자막 탭으로 전환
        switchTab('subtitle');

    } catch (error) {
        console.error('자막 파일 읽기 오류:', error);
        alert('자막 파일을 읽을 수 없습니다.');
    }
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
        if (!currentFileDir) {
            const lastSep = Math.max(externalAudioPath.lastIndexOf('/'), externalAudioPath.lastIndexOf('\\'));
            currentFileDir = lastSep > 0 ? externalAudioPath.substring(0, lastSep) : '';
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

    voiceSentences.forEach((sentence, index) => {
        const row = document.createElement('div');
        row.className = 'sentence-row';
        row.id = `voice-sentence-${index}`;

        row.innerHTML = `
            <span class="sentence-number">${String(index + 1).padStart(3, '0')}</span>
            <span class="sentence-text" data-index="${index}" title="클릭하여 수정">${escapeHtml(sentence)}</span>
            <div class="sentence-actions">
                <button class="btn btn-small btn-edit" data-index="${index}" title="TTS 재생성">🔄</button>
                <button class="btn btn-small btn-play" data-index="${index}" disabled title="듣기">▶</button>
                <button class="btn btn-small btn-download" data-index="${index}" disabled title="다운로드">💾</button>
                <span class="sentence-status">대기중</span>
            </div>
        `;

        elements.voiceContainer.appendChild(row);
    });

    // 문장 텍스트 클릭 시 수정 모드
    elements.voiceContainer.querySelectorAll('.sentence-text').forEach(el => {
        el.addEventListener('click', (e) => enableVoiceEditMode(parseInt(e.target.dataset.index)));
    });

    // 버튼 이벤트 연결
    elements.voiceContainer.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => regenerateSentence(parseInt(e.target.dataset.index)));
    });

    elements.voiceContainer.querySelectorAll('.btn-play').forEach(btn => {
        btn.addEventListener('click', (e) => playSentence(parseInt(e.target.dataset.index)));
    });

    elements.voiceContainer.querySelectorAll('.btn-download').forEach(btn => {
        btn.addEventListener('click', (e) => downloadSentence(parseInt(e.target.dataset.index)));
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
function enableVoiceEditMode(index, cursorPosition = null) {
    const row = document.getElementById(`voice-sentence-${index}`);
    if (!row) return;

    const textEl = row.querySelector('.sentence-text');
    const currentText = voiceSentences[index];

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

    input.addEventListener('keydown', (e) => handleVoiceInputKeydown(e, index, input));

    input.addEventListener('blur', () => {
        // 병합 중에는 blur 이벤트 무시
        if (isMerging) return;
        saveVoiceSentenceEdit(index, input.value);
    });
}

// 음성 탭 입력 키보드 이벤트 처리
function handleVoiceInputKeydown(e, index, input) {
    const cursorPos = input.selectionStart;
    const cursorEnd = input.selectionEnd;
    const textLength = input.value.length;

    if (e.key === 'Enter') {
        e.preventDefault();
        // 커서 위치에서 클립 나누기
        if (cursorPos > 0 && cursorPos < textLength) {
            splitVoiceClip(index, cursorPos);
        } else {
            saveVoiceSentenceEdit(index, input.value);
        }
    } else if (e.key === 'Escape') {
        cancelVoiceSentenceEdit(index);
    } else if (e.key === 'Backspace' && cursorPos === 0 && cursorEnd === 0 && index > 0) {
        // 맨앞에서 Backspace: 앞 클립과 합치기
        e.preventDefault();
        mergeVoiceClipWithPrevious(index);
    } else if (e.key === 'Delete' && cursorPos === textLength && index < voiceSentences.length - 1) {
        // 맨끝에서 Delete: 뒤 클립과 합치기
        e.preventDefault();
        mergeVoiceClipWithNext(index);
    } else if (e.key === 'ArrowUp' && index > 0) {
        // 위쪽 화살표: 이전 클립으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(index, input.value);
        setTimeout(() => enableVoiceEditMode(index - 1, 'end'), 10);
    } else if (e.key === 'ArrowDown' && index < voiceSentences.length - 1) {
        // 아래쪽 화살표: 다음 클립으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(index, input.value);
        setTimeout(() => enableVoiceEditMode(index + 1, 'start'), 10);
    } else if (e.key === 'ArrowLeft' && cursorPos === 0 && cursorEnd === 0 && index > 0) {
        // 맨앞에서 왼쪽 화살표: 이전 클립 끝으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(index, input.value);
        setTimeout(() => enableVoiceEditMode(index - 1, 'end'), 10);
    } else if (e.key === 'ArrowRight' && cursorPos === textLength && index < voiceSentences.length - 1) {
        // 맨끝에서 오른쪽 화살표: 다음 클립 시작으로 이동
        e.preventDefault();
        saveVoiceSentenceEdit(index, input.value);
        setTimeout(() => enableVoiceEditMode(index + 1, 'start'), 10);
    }
}

// 음성 클립 나누기
function splitVoiceClip(index, cursorPos) {
    const currentText = voiceSentences[index];
    const input = document.querySelector(`#voice-sentence-${index} .sentence-input`);
    const newText = input ? input.value : currentText;

    const firstPart = newText.substring(0, cursorPos).trim();
    const secondPart = newText.substring(cursorPos).trim();

    if (!firstPart || !secondPart) return;

    // 히스토리 저장 (변경 전)
    saveVoiceHistory();

    // 배열 업데이트
    voiceSentences.splice(index, 1, firstPart, secondPart);

    // 오디오 파일 배열 업데이트 (분할된 클립은 재생성 필요)
    audioFiles.splice(index, 1, null, null);

    // 캐시 삭제
    delete audioCache[index];

    // UI 재렌더링
    renderVoiceSentences();

    // 두번째 클립 편집 모드로
    setTimeout(() => enableVoiceEditMode(index + 1, 'start'), 10);
}

// 음성 클립 앞 클립과 합치기
function mergeVoiceClipWithPrevious(index) {
    if (index <= 0) return;

    isMerging = true;

    // 히스토리 저장 (변경 전)
    saveVoiceHistory();

    const input = document.querySelector(`#voice-sentence-${index} .sentence-input`);
    const currentText = input ? input.value.trim() : voiceSentences[index];
    const prevText = voiceSentences[index - 1];
    const mergedText = prevText + ' ' + currentText;
    const cursorPos = prevText.length + 1; // 합친 지점

    // 배열 업데이트
    voiceSentences.splice(index - 1, 2, mergedText);

    // 오디오 파일 배열 업데이트
    audioFiles.splice(index - 1, 2, null);

    // 캐시 삭제
    delete audioCache[index - 1];
    delete audioCache[index];

    // UI 재렌더링
    renderVoiceSentences();

    // 합쳐진 클립 편집 모드로 (합친 지점에 커서)
    setTimeout(() => {
        isMerging = false;
        enableVoiceEditMode(index - 1, cursorPos);
    }, 10);
}

// 음성 클립 뒤 클립과 합치기
function mergeVoiceClipWithNext(index) {
    if (index >= voiceSentences.length - 1) return;

    isMerging = true;

    // 히스토리 저장 (변경 전)
    saveVoiceHistory();

    const input = document.querySelector(`#voice-sentence-${index} .sentence-input`);
    const currentText = input ? input.value.trim() : voiceSentences[index];
    const nextText = voiceSentences[index + 1];
    const mergedText = currentText + ' ' + nextText;
    const cursorPos = currentText.length + 1; // 합친 지점

    // 배열 업데이트
    voiceSentences.splice(index, 2, mergedText);

    // 오디오 파일 배열 업데이트
    audioFiles.splice(index, 2, null);

    // 캐시 삭제
    delete audioCache[index];
    delete audioCache[index + 1];

    // UI 재렌더링
    renderVoiceSentences();

    // 합쳐진 클립 편집 모드로 (합친 지점에 커서)
    setTimeout(() => {
        isMerging = false;
        enableVoiceEditMode(index, cursorPos);
    }, 10);
}

// 음성 탭 문장 수정 저장
function saveVoiceSentenceEdit(index, newText) {
    newText = newText.trim();
    if (!newText) {
        cancelVoiceSentenceEdit(index);
        return;
    }

    const oldText = voiceSentences[index];

    const row = document.getElementById(`voice-sentence-${index}`);
    const textEl = row.querySelector('.sentence-text');
    textEl.innerHTML = escapeHtml(newText);

    if (oldText !== newText) {
        // 히스토리 저장 (변경 전)
        saveVoiceHistory();

        voiceSentences[index] = newText;
        audioFiles[index] = null;
        delete audioCache[index];
        updateVoiceSentenceStatus(index, '수정됨');
        row.querySelector('.btn-play').disabled = true;
        row.querySelector('.btn-download').disabled = true;
    }
}

// 음성 탭 문장 수정 취소
function cancelVoiceSentenceEdit(index) {
    const row = document.getElementById(`voice-sentence-${index}`);
    const textEl = row.querySelector('.sentence-text');
    textEl.innerHTML = escapeHtml(voiceSentences[index]);
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
        // 병합 중에는 blur 이벤트 무시
        if (isMerging) return;
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
    const currentText = subtitleSentences[index];
    const input = document.querySelector(`#subtitle-sentence-${index} .sentence-input`);
    const newText = input ? input.value : currentText;

    const firstPart = newText.substring(0, cursorPos).trim();
    const secondPart = newText.substring(cursorPos).trim();

    if (!firstPart || !secondPart) return;

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
    setTimeout(() => enableSubtitleEditMode(index + 1, 'start'), 10);
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
        audioFiles: [...audioFiles],
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
    audioFiles = [...state.audioFiles];
    audioCache = {}; // 캐시 초기화

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
    audioFiles = [...state.audioFiles];
    audioCache = {}; // 캐시 초기화

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
    // 확인 대화상자
    if (!confirm('모든 작업을 초기화하시겠습니까?\n현재 작업 내용이 모두 삭제됩니다.')) {
        return;
    }

    // 플레이어 중지
    closePlayer();

    // 전역 상태 초기화
    voiceSentences = [];
    subtitleSentences = [];
    audioFiles = [];
    audioCache = {};
    subtitleTimecodes = [];
    currentFileName = '';
    currentFilePath = '';
    currentFileDir = '';
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
    stopRequested = false;

    // Undo/Redo 히스토리 초기화
    voiceHistory = [];
    voiceHistoryIndex = -1;
    subtitleHistory = [];
    subtitleHistoryIndex = -1;

    // UI 초기화
    // 파일 입력 초기화
    elements.scriptFile.value = '';
    elements.subtitleFile.value = '';

    // 파일 라벨 초기화
    elements.scriptFileLabel.textContent = '파일 선택';
    elements.scriptInputBtn.classList.remove('loaded');
    elements.subtitleFileLabel.textContent = '파일 선택';
    elements.subtitleInputBtn.classList.remove('loaded');
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
        // 중단 요청 확인
        if (stopRequested) {
            updateProgress(0, '변환이 중단되었습니다.');
            break;
        }

        updateProgress((i / total) * 100, `문장 ${i + 1}/${total} 변환 중...`);
        updateVoiceSentenceStatus(i, '변환중...');

        try {
            const result = await synthesizeSentence(i);
            if (result.success) {
                audioFiles[i] = result.filepath;
                updateVoiceSentenceStatus(i, '완료', true);
            } else {
                updateVoiceSentenceStatus(i, '실패');
            }
        } catch (error) {
            console.error(`문장 ${i + 1} 변환 실패:`, error);
            updateVoiceSentenceStatus(i, '실패');
        }
    }

    if (!stopRequested) {
        updateProgress(100, '변환 완료!');
    }

    const completedCount = audioFiles.filter(f => f !== null).length;
    if (completedCount > 0) {
        elements.playAllBtn.disabled = false;
        elements.exportBtn.disabled = false;
    }

    isProcessing = false;
    stopRequested = false;
    elements.stopBtn.classList.add('hidden');

    setTimeout(() => {
        elements.progressSection.classList.add('hidden');
    }, 2000);
}

// 단일 문장 TTS 변환
async function synthesizeSentence(index) {
    const sentence = voiceSentences[index];
    const outputName = `${currentFileName}_${String(index + 1).padStart(3, '0')}`;

    return await eel.synthesize_sentence(
        sentence,
        elements.language.value,
        elements.voice.value,
        parseFloat(elements.speed.value),
        parseInt(elements.quality.value),
        outputName,
        currentFileDir || null  // 대본 파일 폴더에 저장
    )();
}

// 문장 재생성
async function regenerateSentence(index) {
    if (isProcessing) return;

    const btn = elements.voiceContainer.querySelector(`.btn-edit[data-index="${index}"]`);
    btn.disabled = true;
    updateVoiceSentenceStatus(index, '변환중...');

    try {
        const result = await synthesizeSentence(index);
        if (result.success) {
            audioFiles[index] = result.filepath;
            delete audioCache[index];
            updateVoiceSentenceStatus(index, '완료', true);
        } else {
            updateVoiceSentenceStatus(index, '실패');
        }
    } catch (error) {
        console.error(`문장 ${index + 1} 재생성 실패:`, error);
        updateVoiceSentenceStatus(index, '실패');
    }

    btn.disabled = false;
}

// 음성 문장 상태 업데이트
function updateVoiceSentenceStatus(index, status, enablePlay = false) {
    const row = document.getElementById(`voice-sentence-${index}`);
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

// 단일 문장 재생 (토글 방식: 1번 클릭=재생, 2번 클릭=정지)
async function playSentence(index) {
    const filepath = audioFiles[index];
    if (!filepath) return;

    // 같은 문장을 다시 클릭하면 정지
    if (currentSentenceAudio && currentSentenceIndex === index) {
        currentSentenceAudio.pause();
        currentSentenceAudio.currentTime = 0;
        updatePlayButtonState(currentSentenceIndex, false);
        currentSentenceAudio = null;
        currentSentenceIndex = -1;
        return;
    }

    // 다른 문장이 재생 중이면 먼저 정지
    if (currentSentenceAudio) {
        currentSentenceAudio.pause();
        currentSentenceAudio.currentTime = 0;
        updatePlayButtonState(currentSentenceIndex, false);
    }

    try {
        if (!audioCache[index]) {
            audioCache[index] = await eel.get_audio_url(filepath)();
        }

        currentSentenceAudio = new Audio(audioCache[index]);
        currentSentenceAudio.playbackRate = parseFloat(elements.playerSpeedSelect.value);
        currentSentenceIndex = index;

        // 재생 버튼 상태 업데이트
        updatePlayButtonState(index, true);

        // 재생 완료 시 상태 초기화
        currentSentenceAudio.onended = () => {
            updatePlayButtonState(currentSentenceIndex, false);
            currentSentenceAudio = null;
            currentSentenceIndex = -1;
        };

        currentSentenceAudio.play();
    } catch (error) {
        console.error('재생 실패:', error);
        currentSentenceAudio = null;
        currentSentenceIndex = -1;
    }
}

// 재생 버튼 상태 업데이트 (재생 중이면 ■, 아니면 ▶)
function updatePlayButtonState(index, isPlaying) {
    const btn = elements.voiceContainer.querySelector(`.btn-play[data-index="${index}"]`);
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
async function downloadSentence(index) {
    const filepath = audioFiles[index];
    if (!filepath) return;

    try {
        if (!audioCache[index]) {
            audioCache[index] = await eel.get_audio_url(filepath)();
        }

        const filename = `${currentFileName}_${String(index + 1).padStart(3, '0')}.wav`;

        const link = document.createElement('a');
        link.href = audioCache[index];
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error('다운로드 실패:', error);
        alert('다운로드에 실패했습니다.');
    }
}

// 전체 듣기 시작
function startPlayAll() {
    const validFiles = audioFiles.filter(f => f !== null);
    if (validFiles.length === 0) return;

    currentPlayerIndex = 0;
    isPlaying = true;

    elements.playerSection.classList.remove('hidden');
    elements.playerPlay.textContent = '⏸';

    playCurrentTrack();
}

// 현재 트랙 재생
async function playCurrentTrack() {
    if (currentPlayerIndex >= audioFiles.length) {
        stopPlayer();
        return;
    }

    while (currentPlayerIndex < audioFiles.length && audioFiles[currentPlayerIndex] === null) {
        currentPlayerIndex++;
    }

    if (currentPlayerIndex >= audioFiles.length) {
        stopPlayer();
        return;
    }

    updatePlayerStatus();
    highlightCurrentSentence();

    try {
        if (!audioCache[currentPlayerIndex]) {
            audioCache[currentPlayerIndex] = await eel.get_audio_url(audioFiles[currentPlayerIndex])();
        }

        if (globalAudio) {
            globalAudio.pause();
        }

        globalAudio = new Audio(audioCache[currentPlayerIndex]);
        globalAudio.playbackRate = parseFloat(elements.playerSpeedSelect.value);

        globalAudio.onended = () => {
            if (isPlaying) {
                currentPlayerIndex++;
                setTimeout(() => {
                    playCurrentTrack();
                }, 300);
            }
        };

        globalAudio.ontimeupdate = () => {
            if (globalAudio.duration) {
                const progress = (globalAudio.currentTime / globalAudio.duration) * 100;
                elements.playerProgressBar.style.width = `${progress}%`;
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
    const total = audioFiles.filter(f => f !== null).length;
    const current = audioFiles.slice(0, currentPlayerIndex + 1).filter(f => f !== null).length;
    elements.playerStatus.textContent = `${current} / ${total}`;
}

// 현재 문장 하이라이트
function highlightCurrentSentence() {
    document.querySelectorAll('.sentence-row').forEach(row => {
        row.classList.remove('playing');
    });

    const currentRow = document.getElementById(`voice-sentence-${currentPlayerIndex}`);
    if (currentRow) {
        currentRow.classList.add('playing');
        currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 플레이어 컨트롤
function playerPrev() {
    if (currentPlayerIndex > 0) {
        currentPlayerIndex--;
        while (currentPlayerIndex > 0 && audioFiles[currentPlayerIndex] === null) {
            currentPlayerIndex--;
        }
        if (isPlaying) playCurrentTrack();
        else updatePlayerStatus();
    }
}

function playerNext() {
    if (currentPlayerIndex < audioFiles.length - 1) {
        currentPlayerIndex++;
        while (currentPlayerIndex < audioFiles.length - 1 && audioFiles[currentPlayerIndex] === null) {
            currentPlayerIndex++;
        }
        if (isPlaying) playCurrentTrack();
        else updatePlayerStatus();
    }
}

function playerToggle() {
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

function stopPlayer() {
    isPlaying = false;
    elements.playerPlay.textContent = '▶';
    if (globalAudio) {
        globalAudio.pause();
        globalAudio = null;
    }
    elements.playerProgressBar.style.width = '0%';
    document.querySelectorAll('.sentence-row').forEach(row => {
        row.classList.remove('playing');
    });
}

function closePlayer() {
    stopPlayer();
    elements.playerSection.classList.add('hidden');
}

function updatePlayerSpeed() {
    if (globalAudio) {
        globalAudio.playbackRate = parseFloat(elements.playerSpeedSelect.value);
    }
}

// 내보내기 (파일 병합)
async function exportMergedAudio() {
    const validFiles = audioFiles.filter(f => f !== null);
    if (validFiles.length === 0) {
        alert('내보낼 파일이 없습니다.');
        return;
    }

    elements.exportBtn.disabled = true;
    elements.progressSection.classList.remove('hidden');
    updateProgress(0, '파일 병합 중...');

    try {
        // 대본 파일 폴더에 저장
        const result = await eel.export_merged_audio(validFiles, currentFileName, currentFileDir)();

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
    const validFiles = audioFiles.filter(f => f !== null);
    const hasGeneratedAudio = validFiles.length > 0;
    const hasExternalAudio = externalAudioPath && externalAudioPath.length > 0;

    // 음성 파일 확인 (TTS 생성 또는 외부 파일)
    if (!hasGeneratedAudio && !hasExternalAudio) {
        alert('음성 파일이 없습니다.\nTTS 변환을 진행하거나 외부 오디오 파일을 선택해주세요.');
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
        } else {
            // TTS 생성된 파일 병합
            updateProgress(0, '음성 파일 병합 중...');
            const mergeResult = await eel.export_merged_audio(validFiles, currentFileName, currentFileDir)();

            if (!mergeResult.success) {
                throw new Error(mergeResult.message);
            }
            audioFilePath = mergeResult.filepath;

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

        // Vrew 파일 생성 (대본 파일 폴더에 저장)
        const vrewResult = await eel.export_vrew_file(
            currentFileName,
            audioFilePath,
            subtitleSentences,
            subtitleTimecodes,
            currentFileDir
        )();

        if (!vrewResult.success) {
            throw new Error(vrewResult.message);
        }

        updateProgress(100, 'Vrew 프로젝트 생성 완료!');
        lastExportedFilePath = vrewResult.filepath;
        elements.exportResult.classList.remove('hidden');
        elements.exportMessage.textContent = `✅ Vrew 프로젝트 저장 완료!\n${currentFileName}.vrew\n\nVrew에서 열어 편집하세요.`;
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
