// Direction-Manager 확장 - 3개 고정 플레이스홀더 관리 (컴팩트 UI 전용)
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

// 확장 설정
const extensionName = "Direction-Manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const extensionSettings = extension_settings[extensionName];
// 기본 Direction 프롬프트
const DEFAULT_DIRECTION_PROMPT = `<direction>
- Resume the story based on the director's instructions below.
- The director only provides drafts; refine them into natural prose instead of directly quoting the sentences.
- Creatively construct and fill in any parts lacking persuasive causality so that the narrative suggested by the director unfolds smoothly.

[Direction(If blank, develop the story as you see fit): {{direction}}]
</direction>`;

const defaultSettings = {
    direction: {
        enabled: false,
        content: ""
    },
    char: {
        enabled: false,
        content: ""
    },
    user: {
        enabled: false,
        content: ""
    },
    // 확장 메뉴 설정
    extensionEnabled: true,
    directionPrompt: DEFAULT_DIRECTION_PROMPT,
    promptDepth: 1  // 0: Chat History 끝에 삽입, >0: 끝에서부터 N번째 위치에 삽입
};

// 현재 선택된 플레이스홀더 인덱스
let currentPlaceholderIndex = 0;

// 플레이스홀더 정의 (순서대로)
const placeholders = [
    { key: 'direction', name: '{{direction}}', isCustom: true },
    { key: 'char', name: '{{char}}', isCustom: false },
    { key: 'user', name: '{{user}}', isCustom: false }
];

// 컴팩트 UI 관련 변수들
let compactUIButton = null;
let compactUIPopup = null;

// 설정 로드
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
}

// 플레이스홀더를 시스템에 적용
function applyPlaceholderToSystem(placeholder) {
    const settings = extension_settings[extensionName][placeholder.key];
    
    if (!settings.enabled) {
        // 비활성화된 경우
        if (placeholder.isCustom) {
            // 커스텀 플레이스홀더는 시스템에서 제거
            removePlaceholderFromSystem(placeholder.key);
        } else {
            // 사전등록된 플레이스홀더는 덮어쓴 값을 제거하여 원래 시스템 값으로 복원
            restoreSystemPlaceholder(placeholder.key);
        }
        return;
    }
    
    // 활성화된 경우
    if (placeholder.isCustom) {
        // 커스텀 플레이스홀더는 직접 생성
        registerCustomPlaceholder(placeholder.key, settings.content);
    } else {
        // 사전등록된 플레이스홀더는 값 대체
        // 내용이 비어있으면 기존 시스템 값을 유지 (마치 비활성화된 것처럼 동작)
        if (settings.content && settings.content.trim() !== '') {
            replaceSystemPlaceholder(placeholder.key, settings.content);
        } else {
            restoreSystemPlaceholder(placeholder.key);
        }
    }
}

// 커스텀 플레이스홀더 등록
function registerCustomPlaceholder(key, content) {
    try {
        const context = getContext();
        if (context && context.registerMacro) {
            // 기존 매크로가 있으면 먼저 제거
            if (context.unregisterMacro) {
                context.unregisterMacro(key);
            }
            
            context.registerMacro(key, content || '', `Direction Manager: ${key}`);
        }
    } catch (error) {
        console.warn('Failed to register custom placeholder:', error);
    }
}

// 시스템 플레이스홀더 값 대체
function replaceSystemPlaceholder(key, content) {
    try {
        const context = getContext();
        if (context && context.registerMacro) {
            // 기존 매크로가 있으면 먼저 제거 (깔끔한 덮어쓰기를 위해)
            if (context.unregisterMacro) {
                context.unregisterMacro(key);
            }
            
            // 새로운 값으로 매크로 등록
            context.registerMacro(key, content || '', `Direction Manager override: ${key}`);
        }
    } catch (error) {
        console.warn('Failed to replace system placeholder:', error);
    }
}

// 시스템에서 플레이스홀더 제거
function removePlaceholderFromSystem(key) {
    try {
        const context = getContext();
        if (context && context.unregisterMacro) {
            context.unregisterMacro(key);
        }
    } catch (error) {
        console.warn('Failed to remove placeholder from system:', error);
    }
}

// 시스템 플레이스홀더를 원래 값으로 복원
function restoreSystemPlaceholder(key) {
    try {
        const context = getContext();
        if (context && context.unregisterMacro) {
            // Direction Manager가 덮어쓴 매크로를 제거
            context.unregisterMacro(key);
        }
        // 시스템이 원래 매크로를 자동으로 복원함
    } catch (error) {
        console.warn('Failed to restore system placeholder:', error);
    }
}

// 모든 플레이스홀더 적용
function applyAllPlaceholders() {
    placeholders.forEach(placeholder => {
        applyPlaceholderToSystem(placeholder);
    });
}

// 모든 플레이스홀더 제거
function removeAllPlaceholders() {
    placeholders.forEach(placeholder => {
        if (placeholder.isCustom) {
            // 커스텀 플레이스홀더는 시스템에서 제거
            removePlaceholderFromSystem(placeholder.key);
        } else {
            // 사전등록된 플레이스홀더는 원래 시스템 값으로 복원
            restoreSystemPlaceholder(placeholder.key);
        }
    });
}

// 컴팩트 UI 팝업 닫기
function closeCompactUIPopup() {
    if (compactUIPopup) {
        compactUIPopup.removeClass('dm-compact--active');
        setTimeout(() => {
            compactUIPopup.remove();
            compactUIPopup = null;
        }, 200);
    }
    
    if (compactUIButton) {
        compactUIButton.removeClass('dm-compact--hasPopup');
    }
}

// 컴팩트 UI 팝업 표시
function showCompactUIPopup() {
    if (compactUIPopup) {
        return closeCompactUIPopup();
    }
    
    const currentPlaceholder = placeholders[currentPlaceholderIndex];
    const settings = extension_settings[extensionName][currentPlaceholder.key];
    
    compactUIButton.addClass('dm-compact--hasPopup');
    
    const popupHtml = `
        <div class="dm-compact--popup">
            <div class="dm-compact--header">
                <button class="dm-compact--nav dm-compact--prev" title="이전 플레이스홀더">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="dm-compact--title-row">
                    <input type="checkbox" class="dm-compact--radio" ${settings.enabled ? 'checked' : ''}>
                    <div class="dm-compact--title">${currentPlaceholder.name}</div>
                </div>
                <button class="dm-compact--nav dm-compact--clear" title="내용 지우기">
                    <i class="fa-solid fa-eraser"></i>
                </button>
                <button class="dm-compact--nav dm-compact--next" title="다음 플레이스홀더">
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            </div>
            <div class="dm-compact--content">
                <textarea class="dm-compact--textarea" 
                          placeholder="플레이스홀더 내용을 입력하세요..." 
                          ${!settings.enabled ? 'disabled' : ''}>${settings.content || ''}</textarea>
            </div>
        </div>
    `;
    
    compactUIPopup = $(popupHtml);
    $('#nonQRFormItems').append(compactUIPopup);
    
    // 애니메이션
    setTimeout(() => {
        compactUIPopup.addClass('dm-compact--active');
    }, 10);
    
    // 이벤트 핸들러 설정
    setupCompactUIEventListeners();
}

// 컴팩트 UI 이벤트 리스너 설정
function setupCompactUIEventListeners() {
    if (!compactUIPopup) return;
    
    // 이전 플레이스홀더 버튼
    compactUIPopup.find('.dm-compact--prev').on('click', () => {
        navigateCompactPlaceholder(-1);
    });
    
    // 다음 플레이스홀더 버튼
    compactUIPopup.find('.dm-compact--next').on('click', () => {
        navigateCompactPlaceholder(1);
    });
    
    // 라디오 버튼 변경 이벤트
    compactUIPopup.find('.dm-compact--radio').on('change', function() {
        const isEnabled = $(this).is(':checked');
        const currentPlaceholder = placeholders[currentPlaceholderIndex];
        
        extension_settings[extensionName][currentPlaceholder.key].enabled = isEnabled;
        
        // 텍스트에어리어 활성화/비활성화
        const textarea = compactUIPopup.find('.dm-compact--textarea');
        textarea.prop('disabled', !isEnabled);
        
        applyPlaceholderToSystem(currentPlaceholder);
        saveSettingsDebounced();
    });
    
    // 지우개 버튼
    compactUIPopup.find('.dm-compact--clear').on('click', function() {
        const confirmed = confirm('이 플레이스홀더의 내용을 모두 지우시겠습니까?');
        if (confirmed) {
            const currentPlaceholder = placeholders[currentPlaceholderIndex];
            extension_settings[extensionName][currentPlaceholder.key].content = "";
            compactUIPopup.find('.dm-compact--textarea').val('');
            applyPlaceholderToSystem(currentPlaceholder);
            saveSettingsDebounced();
        }
    });
    
    // 텍스트에어리어 변경 이벤트
    compactUIPopup.find('.dm-compact--textarea').on('input', function() {
        const newContent = $(this).val();
        const currentPlaceholder = placeholders[currentPlaceholderIndex];
        
        extension_settings[extensionName][currentPlaceholder.key].content = newContent;
        applyPlaceholderToSystem(currentPlaceholder);
        saveSettingsDebounced();
    });
    
    // 외부 클릭시 닫기
    $(document).on('click.compactUI', (e) => {
        if (!$(e.target).closest('.dm-compact--popup, .dm-compact--button').length) {
            closeCompactUIPopup();
            $(document).off('click.compactUI');
        }
    });
}

// 컴팩트 UI 플레이스홀더 네비게이션
function navigateCompactPlaceholder(direction) {
    currentPlaceholderIndex += direction;
    
    if (currentPlaceholderIndex < 0) {
        currentPlaceholderIndex = placeholders.length - 1;
    } else if (currentPlaceholderIndex >= placeholders.length) {
        currentPlaceholderIndex = 0;
    }
    
    // 팝업 업데이트
    const currentPlaceholder = placeholders[currentPlaceholderIndex];
    const settings = extension_settings[extensionName][currentPlaceholder.key];
    
    compactUIPopup.find('.dm-compact--title').text(currentPlaceholder.name);
    compactUIPopup.find('.dm-compact--radio').prop('checked', settings.enabled);
    compactUIPopup.find('.dm-compact--textarea')
        .val(settings.content || '')
        .prop('disabled', !settings.enabled);
}

// 컴팩트 UI 버튼 추가
function addCompactUIButton() {
    const ta = document.querySelector('#send_textarea');
    if (!ta) {
        setTimeout(addCompactUIButton, 1000);
        return;
    }
    
    // 기존 버튼 제거
    if (compactUIButton) {
        compactUIButton.remove();
        compactUIButton = null;
    }
    
    const buttonHtml = `
        <div class="dm-compact--button menu_button" title="Direction Manager 빠른 편집">
            <i class="fa-solid fa-feather"></i>
        </div>
    `;
    
    compactUIButton = $(buttonHtml);
    $(ta).after(compactUIButton);
    
    // 확장 활성화 상태에 따라 버튼 표시/숨김
    const settings = extension_settings[extensionName];
    if (settings && settings.extensionEnabled) {
        compactUIButton.show();
    } else {
        compactUIButton.hide();
    }
    
    // 클릭 이벤트
    compactUIButton.on('click', showCompactUIPopup);
}

// 확장 메뉴 초기화
async function initializeExtensionMenu() {
    try {
        // HTML 로드 및 삽입
        const html = await $.get(`/scripts/extensions/third-party/${extensionName}/settings.html`);
        $('#extensions_settings').append(html);
        
        // UI 업데이트
        updateExtensionMenuUI();
        
        // 이벤트 핸들러 설정
        setupExtensionMenuEventHandlers();
        
        console.log(`[${extensionName}] 확장 메뉴 초기화 완료`);
    } catch (error) {
        console.error(`[${extensionName}] 확장 메뉴 초기화 실패:`, error);
    }
}

// 확장 메뉴 UI 업데이트
function updateExtensionMenuUI() {
    const settings = extension_settings[extensionName];
    
    // 활성화 체크박스 상태 설정
    $('#direction_manager_enabled').prop('checked', settings.extensionEnabled);
    
    // 프롬프트 텍스트 설정
    $('#direction_prompt_text').val(settings.directionPrompt || DEFAULT_DIRECTION_PROMPT);
    
    // Depth 설정
    $('#direction_prompt_depth').val(settings.promptDepth || 1);
}

// 확장 메뉴 이벤트 핸들러 설정
function setupExtensionMenuEventHandlers() {
    // 활성화 체크박스 변경 이벤트 (전체 확장 기능 제어)
    $('#direction_manager_enabled').on('change', function() {
        const isEnabled = $(this).is(':checked');
        extension_settings[extensionName].extensionEnabled = isEnabled;
        
        if (isEnabled) {
            // 확장 활성화 시: 컴팩트 UI 버튼 표시 및 모든 플레이스홀더 적용
            if (compactUIButton) {
                compactUIButton.show();
            }
            applyAllPlaceholders();
        } else {
            // 확장 비활성화 시: 컴팩트 UI 버튼 숨김 및 모든 매크로 제거
            if (compactUIButton) {
                compactUIButton.hide();
                // 팝업이 열려있으면 닫기
                if (compactUIPopup) {
                    closeCompactUIPopup();
                }
            }
            removeAllPlaceholders();
        }
        
        saveSettingsDebounced();
    });
    
    // 프롬프트 텍스트 변경 이벤트 (실시간 저장)
    $('#direction_prompt_text').on('input', function() {
        extension_settings[extensionName].directionPrompt = $(this).val();
        saveSettingsDebounced();
    });

    // Depth 설정 변경 이벤트
    $('#direction_prompt_depth').on('input', function() {
        const value = parseInt(String($(this).val()));
        extension_settings[extensionName].promptDepth = isNaN(value) ? 1 : value;
        saveSettingsDebounced();
    });

    // 기본값 초기화 버튼
    $('#direction_reset_prompt').on('click', function() {
        $('#direction_prompt_text').val(DEFAULT_DIRECTION_PROMPT);
        $('#direction_prompt_depth').val(1);
        extension_settings[extensionName].directionPrompt = DEFAULT_DIRECTION_PROMPT;
        extension_settings[extensionName].promptDepth = 1;
        saveSettingsDebounced();
    });
}

// 프롬프트 주입 함수
function injectDirectionPrompt(eventData) {
    const settings = extension_settings[extensionName];
    
    // 확장이 비활성화되어 있으면 주입하지 않음
    if (!settings.extensionEnabled) {
        return;
    }
    
    // Direction 토글이 비활성화되어 있으면 주입하지 않음
    if (!settings.direction.enabled) {
        return;
    }
    
    // 프롬프트가 비어있으면 주입하지 않음
    if (!settings.directionPrompt || settings.directionPrompt.trim() === '') {
        return;
    }
    
    // 플레이스홀더 치환
    let processedPrompt = settings.directionPrompt;
    
    // {{direction}} 플레이스홀더 치환
    if (settings.direction.content) {
        processedPrompt = processedPrompt.replace(/\{\{direction\}\}/g, settings.direction.content);
    } else {
        processedPrompt = processedPrompt.replace(/\{\{direction\}\}/g, '');
    }
    
    // {{char}} 플레이스홀더 치환
    if (settings.char.enabled && settings.char.content) {
        processedPrompt = processedPrompt.replace(/\{\{char\}\}/g, settings.char.content);
    }
    
    // {{user}} 플레이스홀더 치환
    if (settings.user.enabled && settings.user.content) {
        processedPrompt = processedPrompt.replace(/\{\{user\}\}/g, settings.user.content);
    }
    
    const depth = settings.promptDepth || 1;
    
    // 참고 파일 방식: eventData.chat 또는 eventData.messages 확인
    let messages = eventData.chat || eventData.messages;
    
    if (messages && Array.isArray(messages)) {
        // system 메시지 생성
        const systemMessage = {
            role: 'system',
            content: processedPrompt
        };
        
        // 참고 파일의 방식을 따라 depth 적용
        if (depth === 0) {
            // 맨 끝에 추가
            messages.push(systemMessage);
        } else {
            // 끝에서부터 N번째 위치에 삽입
            const insertIndex = Math.max(messages.length - depth, 0);
            messages.splice(insertIndex, 0, systemMessage);
        }
    }
}

// 확장 초기화
jQuery(async () => {
    await loadSettings();
    applyAllPlaceholders();
    
    // 확장 메뉴 초기화
    await initializeExtensionMenu();
    
    // 컴팩트 UI 버튼 추가
    addCompactUIButton();
    
    // 프롬프트 주입 이벤트 리스너 등록
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, injectDirectionPrompt);
});
