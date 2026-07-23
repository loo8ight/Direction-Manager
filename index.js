// Direction-Manager 확장 - 3개 고정 플레이스홀더 관리 (컴팩트 UI 전용)
import { extension_settings, getContext, saveMetadataDebounced } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

// 확장 설정
const extensionName = "Direction-Manager";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
// 기본 Direction 프롬프트
const DEFAULT_DIRECTION_PROMPT = `<direction>
- Resume the story based on the director's instructions below.
- The director only provides drafts; refine them into natural prose instead of directly quoting the sentences.
- Creatively construct and fill in any parts lacking persuasive causality so that the narrative suggested by the director unfolds smoothly.

[Direction(If blank, develop the story as you see fit): {{direction}}]
</direction>`;

const PLACEHOLDER_DEFAULTS = {
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
    }
};

const defaultSettings = {
    // 확장 메뉴 설정
    extensionEnabled: true,
    directionPrompt: DEFAULT_DIRECTION_PROMPT,
    promptDepth: 1,  // 0: Chat History 끝에 삽입, >0: 끝에서부터 N번째 위치에 삽입
    activeScope: 'chat',
    impersonateMode: false,
    autoCycleMode: false,
    globalSwapCharUser: false,
    legacyGlobalPlaceholdersMigrated: false
};

// 현재 선택된 플레이스홀더 인덱스
let currentPlaceholderIndex = 0;

// 플레이스홀더 정의 (순서대로)
const placeholders = [
    { key: 'direction', name: '{{direction}}', isCustom: true },
    { key: 'char', name: '{{char}}', isCustom: false },
    { key: 'user', name: '{{user}}', isCustom: false }
];

const compactPages = [
    { key: 'direction', title: '{{direction}}', type: 'single', placeholderKey: 'direction' },
    { key: 'name', title: '{{name}}', type: 'names' },
];

const CHAT_METADATA_KEY = 'directionManager';
const ACTIVE_DIRECTION_REQUEST_EVENT = 'directionManagerRequestActiveDirection';
const WRITE_SUPPORTER_DIRECTION_MARKER = '[WRITE_SUPPORTER_DIRECTION_CONTEXT_INCLUDED]';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[char]);
}

function clonePlaceholderState(source = PLACEHOLDER_DEFAULTS) {
    return placeholders.reduce((result, { key }) => {
        const value = source?.[key] || PLACEHOLDER_DEFAULTS[key];
        result[key] = {
            enabled: Boolean(value.enabled),
            content: String(value.content ?? '')
        };
        return result;
    }, {});
}

function ensurePlaceholderEntry(container, key, fallback = PLACEHOLDER_DEFAULTS[key]) {
    if (!container[key] || typeof container[key] !== 'object') {
        container[key] = { ...fallback };
    }

    container[key].enabled = Boolean(container[key].enabled);
    container[key].content = String(container[key].content ?? '');
    return container[key];
}

function normalizeScope(scope) {
    return scope === 'global' ? 'global' : 'chat';
}

function hasPlaceholderValues(source) {
    if (!source || typeof source !== 'object') {
        return false;
    }

    return placeholders.some(({ key }) => {
        const value = source[key];
        return Boolean(value?.enabled) || String(value?.content ?? '').trim() !== '';
    });
}

function getActiveScope() {
    return normalizeScope(extension_settings[extensionName]?.activeScope);
}

function getGlobalPlaceholderStore() {
    const settings = extension_settings[extensionName];
    if (!settings.globalPlaceholders || typeof settings.globalPlaceholders !== 'object') {
        settings.globalPlaceholders = clonePlaceholderState();
    }

    placeholders.forEach(({ key }) => ensurePlaceholderEntry(settings.globalPlaceholders, key));
    return settings.globalPlaceholders;
}

function getChatMetadataRoot(create = false) {
    const context = getContext();
    if (!context) {
        return null;
    }

    if (!context.chatMetadata || typeof context.chatMetadata !== 'object') {
        if (!create) {
            return null;
        }
        context.chatMetadata = {};
    }

    if (!context.chatMetadata[CHAT_METADATA_KEY] || typeof context.chatMetadata[CHAT_METADATA_KEY] !== 'object') {
        if (!create) {
            return null;
        }
        context.chatMetadata[CHAT_METADATA_KEY] = {};
    }

    return context.chatMetadata[CHAT_METADATA_KEY];
}

function getChatPlaceholderStore(create = false, seedSource = null) {
    const root = getChatMetadataRoot(create);
    if (!root) {
        return null;
    }

    if (!root.placeholders || typeof root.placeholders !== 'object') {
        if (!create) {
            return null;
        }
        root.placeholders = clonePlaceholderState(seedSource);
    }

    placeholders.forEach(({ key }) => {
        ensurePlaceholderEntry(root.placeholders, key, seedSource?.[key] || PLACEHOLDER_DEFAULTS[key]);
    });

    return root.placeholders;
}

function getScopePlaceholderStore(scope = getActiveScope(), create = false) {
    if (normalizeScope(scope) === 'global') {
        return getGlobalPlaceholderStore();
    }

    const chatStore = getChatPlaceholderStore(create);
    return chatStore || clonePlaceholderState();
}

function getPlaceholderSettings(placeholderKey, scope = getActiveScope(), create = false) {
    return getScopePlaceholderStore(scope, create)[placeholderKey];
}
function getActiveDirectionSnapshot() {
    const settings = extension_settings[extensionName];
    if (!settings?.extensionEnabled) {
        return null;
    }

    const scope = getActiveScope();
    const direction = getPlaceholderSettings('direction', scope, false);
    const content = String(direction?.content ?? '').trim();
    if (!direction?.enabled || !content) {
        return null;
    }

    return { scope, content };
}

function handleActiveDirectionRequest(event) {
    if (!event?.detail || typeof event.detail !== 'object') {
        return;
    }

    event.detail.result = getActiveDirectionSnapshot();
}

function getSwapState(scope = getActiveScope()) {
    if (normalizeScope(scope) === 'global') {
        return Boolean(extension_settings[extensionName]?.globalSwapCharUser);
    }

    const root = getChatMetadataRoot(false);
    return Boolean(root?.swapCharUser);
}

function setSwapState(value, scope = getActiveScope()) {
    const normalizedValue = Boolean(value);

    if (normalizeScope(scope) === 'global') {
        extension_settings[extensionName].globalSwapCharUser = normalizedValue;
        return normalizedValue;
    }

    const root = getChatMetadataRoot(true);
    if (root) {
        root.swapCharUser = normalizedValue;
    }

    return normalizedValue;
}

function getSystemNameGetter(key) {
    const contextKey = key === 'char' ? 'name2' : 'name1';

    return () => {
        const context = getContext();
        return String(context?.[contextKey] ?? '');
    };
}

function getEffectiveNameValue(key, scope = getActiveScope(), dynamic = false) {
    const settings = getPlaceholderSettings(key, scope);
    const content = String(settings?.content ?? '');

    if (settings?.enabled && content.trim() !== '') {
        return content;
    }

    const getter = getSystemNameGetter(key);
    return dynamic ? getter : getter();
}

function getCharUserMacroValues(scope = getActiveScope(), dynamic = false) {
    const effectiveChar = getEffectiveNameValue('char', scope, dynamic);
    const effectiveUser = getEffectiveNameValue('user', scope, dynamic);

    if (getSwapState(scope)) {
        // Group chats can have speaker-specific native {{char}} behavior. The swapped fallback uses the current context name2 value.
        return {
            char: effectiveUser,
            user: effectiveChar,
        };
    }

    return {
        char: effectiveChar,
        user: effectiveUser,
    };
}

function getCurrentCompactPage() {
    return compactPages[currentPlaceholderIndex] || compactPages[0];
}

function getNameStorageKeyForOutput(outputKey, scope = getActiveScope()) {
    if (!getSwapState(scope)) {
        return outputKey;
    }

    return outputKey === 'char' ? 'user' : 'char';
}

function getNameRowData(outputKey, scope = getActiveScope()) {
    const storageKey = getNameStorageKeyForOutput(outputKey, scope);
    const settings = getPlaceholderSettings(storageKey, scope);

    return {
        outputKey,
        storageKey,
        settings,
        systemName: getSystemNameGetter(storageKey)(),
    };
}

function renderNameRows(scope = getActiveScope()) {
    return ['char', 'user'].map((outputKey) => {
        const row = getNameRowData(outputKey, scope);
        const content = String(row.settings?.content ?? '');
        const isEnabled = Boolean(row.settings?.enabled);

        return `
            <div class="dm-name-row" data-output-key="${row.outputKey}" data-storage-key="${row.storageKey}">
                <input type="checkbox" class="dm-name-enabled" ${isEnabled ? 'checked' : ''}>
                <label class="dm-name-label">{{${row.outputKey}}}</label>
                <input type="text"
                       class="dm-name-input"
                       value="${escapeHtml(content)}"
                       placeholder="${escapeHtml(row.systemName)}"
                       ${!isEnabled ? 'disabled' : ''}>
            </div>
        `;
    }).join('');
}

function saveScopeState(scope = getActiveScope()) {
    if (normalizeScope(scope) === 'global') {
        saveSettingsDebounced();
        return;
    }

    if (!getChatMetadataRoot(false)) {
        return;
    }

    saveMetadataDebounced();
}

function migrateLegacyGlobalPlaceholdersToGlobal() {
    const settings = extension_settings[extensionName];
    if (settings.legacyGlobalPlaceholdersMigrated) {
        return;
    }

    const legacyRootPlaceholders = placeholders.reduce((result, { key }) => {
        result[key] = settings[key];
        return result;
    }, {});

    if (hasPlaceholderValues(legacyRootPlaceholders) && !hasPlaceholderValues(settings.globalPlaceholders)) {
        settings.globalPlaceholders = clonePlaceholderState(legacyRootPlaceholders);
    }

    settings.legacyGlobalPlaceholdersMigrated = true;
    saveSettingsDebounced();
}

function updateScopeButtons($container, scope = getActiveScope()) {
    if (!$container || !$container.length) {
        return;
    }

    $container.find('.dm-scope-btn').removeClass('active');
    $container.find(`.dm-scope-btn[data-scope="${scope}"]`).addClass('active');
}

function syncCompactUIPopup() {
    updateCompactUIButtonState();

    if (!compactUIPopup) {
        return;
    }

    const page = getCurrentCompactPage();
    const scope = getActiveScope();
    const isImpersonateOn = Boolean(extension_settings[extensionName]?.impersonateMode);
    const isAutoCycleOn = Boolean(extension_settings[extensionName]?.autoCycleMode);
    const isSwapOn = getSwapState(scope);
    const isDirectionPage = page.type === 'single';

    compactUIPopup.find('.dm-compact--title')
        .text(page.title);
    compactUIPopup.find('.dm-compact--radio').toggle(isDirectionPage);
    compactUIPopup.find('.dm-compact--clear').toggle(isDirectionPage);

    if (isDirectionPage) {
        const settings = getPlaceholderSettings(page.placeholderKey, scope);
        compactUIPopup.find('.dm-compact--radio').prop('checked', settings.enabled);
        compactUIPopup.find('.dm-compact--content').html(`
            <textarea class="dm-compact--textarea"
                      placeholder="플레이스홀더 내용을 입력하세요..."
                      ${!settings.enabled ? 'disabled' : ''}>${escapeHtml(settings.content || '')}</textarea>
        `);
    } else {
        compactUIPopup.find('.dm-compact--radio').prop('checked', false);
        compactUIPopup.find('.dm-compact--content').html(`
            <div class="dm-name-rows">
                ${renderNameRows(scope)}
            </div>
        `);
    }

    updateScopeButtons(compactUIPopup, scope);
    compactUIPopup.find('.dm-auto-cycle-btn')
        .toggleClass('active', isAutoCycleOn)
        .attr('aria-pressed', String(isAutoCycleOn))
        .attr('title', isAutoCycleOn ? '순환 대필 켜짐' : '순환 대필 꺼짐');
    compactUIPopup.find('.dm-impersonate-btn')
        .toggleClass('active', isImpersonateOn)
        .attr('aria-pressed', String(isImpersonateOn))
        .attr('title', isImpersonateOn ? '대필 모드 켜짐' : '대필 모드 꺼짐');
    compactUIPopup.find('.dm-swap-btn')
        .toggleClass('active', isSwapOn)
        .attr('aria-pressed', String(isSwapOn))
        .attr('title', isSwapOn ? '오버라이드(역할 반전) 켜짐' : '오버라이드(역할 반전) 꺼짐');
}

function updateCompactUIButtonState() {
    if (!compactUIButton) {
        return;
    }

    const settings = extension_settings[extensionName];
    const isDirectionOn = Boolean(settings?.extensionEnabled && getPlaceholderSettings('direction')?.enabled);
    const isImpersonateOn = Boolean(settings?.extensionEnabled && settings?.impersonateMode);
    const isAutoCycleOn = Boolean(settings?.extensionEnabled && settings?.autoCycleMode);
    const isSwapOn = Boolean(settings?.extensionEnabled && getSwapState());
    const title = isImpersonateOn
        ? `Direction Manager - 대필 모드 켜짐${isAutoCycleOn ? ', 순환 대필 켜짐' : ''}${isSwapOn ? ', 역할 반전 켜짐' : ''}`
        : `Direction Manager 빠른 편집 - 전개 지시 ${isDirectionOn ? '켜짐' : '꺼짐'}${isAutoCycleOn ? ', 순환 대필 켜짐' : ''}${isSwapOn ? ', 역할 반전 켜짐' : ''}`;

    compactUIButton
        .toggleClass('dm-compact--directionOn', isDirectionOn)
        .toggleClass('dm-compact--impersonateOn', isImpersonateOn)
        .toggleClass('dm-compact--autoCycleOn', isAutoCycleOn)
        .toggleClass('dm-compact--swapOn', isSwapOn)
        .attr('title', title)
        .attr('aria-pressed', String(isDirectionOn || isImpersonateOn || isAutoCycleOn || isSwapOn));

    compactUIButton.children('i')
        .toggleClass('fa-feather', !isImpersonateOn)
        .toggleClass('fa-user', isImpersonateOn);
}

function setActiveScope(scope) {
    const normalized = normalizeScope(scope);

    if (extension_settings[extensionName].activeScope === normalized) {
        updateExtensionMenuUI();
        syncCompactUIPopup();
        return;
    }

    extension_settings[extensionName].activeScope = normalized;

    if (extension_settings[extensionName].extensionEnabled) {
        applyAllPlaceholders();
    } else {
        removeAllPlaceholders();
    }

    updateExtensionMenuUI();
    syncCompactUIPopup();
    saveSettingsDebounced();
}

// 컴팩트 UI 관련 변수들
let compactUIButton = null;
let compactUIPopup = null;

// 설정 로드
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const settings = extension_settings[extensionName];

    if (Object.keys(settings).length === 0) {
        Object.assign(settings, {
            extensionEnabled: defaultSettings.extensionEnabled,
            directionPrompt: defaultSettings.directionPrompt,
            promptDepth: defaultSettings.promptDepth,
            activeScope: defaultSettings.activeScope,
            impersonateMode: defaultSettings.impersonateMode,
            autoCycleMode: defaultSettings.autoCycleMode,
            globalSwapCharUser: defaultSettings.globalSwapCharUser,
            legacyGlobalPlaceholdersMigrated: defaultSettings.legacyGlobalPlaceholdersMigrated,
        });
    }

    settings.extensionEnabled = typeof settings.extensionEnabled === 'boolean' ? settings.extensionEnabled : defaultSettings.extensionEnabled;
    settings.directionPrompt = typeof settings.directionPrompt === 'string' ? settings.directionPrompt : defaultSettings.directionPrompt;
    settings.promptDepth = Number.isFinite(Number(settings.promptDepth)) ? Number(settings.promptDepth) : defaultSettings.promptDepth;
    settings.activeScope = normalizeScope(settings.activeScope);
    settings.impersonateMode = typeof settings.impersonateMode === 'boolean'
        ? settings.impersonateMode
        : defaultSettings.impersonateMode;
    settings.autoCycleMode = typeof settings.autoCycleMode === 'boolean'
        ? settings.autoCycleMode
        : defaultSettings.autoCycleMode;
    settings.globalSwapCharUser = Boolean(settings.globalSwapCharUser);
    settings.legacyGlobalPlaceholdersMigrated = typeof settings.legacyGlobalPlaceholdersMigrated === 'boolean'
        ? settings.legacyGlobalPlaceholdersMigrated
        : defaultSettings.legacyGlobalPlaceholdersMigrated;

    getGlobalPlaceholderStore();
    migrateLegacyGlobalPlaceholdersToGlobal();
}

// 플레이스홀더를 시스템에 적용
function applyPlaceholderToSystem(placeholder) {
    if (placeholder.key === 'char' || placeholder.key === 'user') {
        applyCharUserMacros();
        return;
    }

    const settings = getPlaceholderSettings(placeholder.key);
    
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

function applyCharUserMacros() {
    const scope = getActiveScope();

    if (getSwapState(scope)) {
        const macroValues = getCharUserMacroValues(scope, true);
        replaceSystemPlaceholder('char', macroValues.char);
        replaceSystemPlaceholder('user', macroValues.user);
        return;
    }

    ['char', 'user'].forEach((key) => {
        const settings = getPlaceholderSettings(key, scope);
        const content = String(settings?.content ?? '');

        if (settings?.enabled && content.trim() !== '') {
            replaceSystemPlaceholder(key, content);
        } else {
            restoreSystemPlaceholder(key);
        }
    });
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
        if (placeholder.key === 'char' || placeholder.key === 'user') {
            return;
        }

        applyPlaceholderToSystem(placeholder);
    });
    applyCharUserMacros();
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

    $(window).off('resize.dmCompactPopup scroll.dmCompactPopup');
    $(document).off('click.compactUI');
    
    if (compactUIButton) {
        compactUIButton.removeClass('dm-compact--hasPopup');
    }
}

// 컴팩트 UI 팝업 표시
function showCompactUIPopup() {
    if (compactUIPopup) {
        return closeCompactUIPopup();
    }
    
    const page = getCurrentCompactPage();
    const isSwapOn = getSwapState();
    
    compactUIButton.addClass('dm-compact--hasPopup');
    
    const popupHtml = `
        <div class="dm-compact--popup">
            <div class="dm-compact--header">
                <button class="dm-compact--nav dm-compact--prev" title="이전 플레이스홀더">
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
                <div class="dm-compact--title-row">
                    <input type="checkbox" class="dm-compact--radio">
                    <div class="dm-compact--title">${page.title}</div>
                </div>
                <div class="dm-compact--toolbar">
                    <button class="dm-compact--nav dm-compact--clear" title="내용 지우기">
                        <i class="fa-solid fa-eraser"></i>
                    </button>
                    <button class="dm-compact--nav dm-compact--next" title="다음 플레이스홀더">
                        <i class="fa-solid fa-chevron-right"></i>
                    </button>
                </div>
            </div>
            <div class="dm-compact--content"></div>
            <div class="dm-compact--footer">
                <div class="dm-scope-toggle" title="저장 범위">
                    <button type="button" class="dm-scope-btn" data-scope="chat" title="챗 저장">
                        <i class="fa-solid fa-comments"></i>
                    </button>
                    <button type="button" class="dm-scope-btn" data-scope="global" title="글로벌 저장">
                        <i class="fa-solid fa-globe"></i>
                    </button>
                </div>
                <div class="dm-compact--actions">
                    <button type="button" class="dm-auto-cycle-btn" aria-pressed="false" title="순환 대필 꺼짐">
                        <i class="fa-solid fa-rotate"></i>
                    </button>
                    <button type="button" class="dm-impersonate-btn" aria-pressed="false" title="대필 모드 꺼짐">
                        <i class="fa-solid fa-user"></i>
                    </button>
                    <button type="button" class="dm-swap-btn ${isSwapOn ? 'active' : ''}" aria-pressed="${String(isSwapOn)}" title="${isSwapOn ? '오버라이드(역할 반전) 켜짐' : '오버라이드(역할 반전) 꺼짐'}">
                        <i class="fa-solid fa-right-left"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
    
    compactUIPopup = $(popupHtml);
    const $popupHost = $('#nonQRFormItems');
    if ($popupHost.length) {
        $popupHost.append(compactUIPopup);
    } else {
        compactUIButton.after(compactUIPopup);
    }

    syncCompactUIPopup();
    
    // 애니메이션
    setTimeout(() => {
        compactUIPopup.addClass('dm-compact--active');
    }, 10);
    
    // 이벤트 핸들러 설정
    setupCompactUIEventListeners();
}

// 버튼 위치 기준으로 팝업 위치 계산
function positionCompactUIPopup() {
    if (!compactUIButton || !compactUIPopup) return;

    const btnRect = compactUIButton[0].getBoundingClientRect();
    const margin = 6;

    const popupWidth = compactUIPopup.outerWidth();
    const popupHeight = compactUIPopup.outerHeight();

    let left = btnRect.right - popupWidth;
    let top = btnRect.top - popupHeight - margin;

    // 위로 공간이 부족하면 아래로 표시
    if (top < margin) {
        top = btnRect.bottom + margin;
        compactUIPopup.addClass('dm-compact--below');
    } else {
        compactUIPopup.removeClass('dm-compact--below');
    }

    // 화면을 벗어나지 않도록 좌우 보정
    left = Math.max(margin, Math.min(left, window.innerWidth - popupWidth - margin));

    compactUIPopup.css({
        top: `${top}px`,
        left: `${left}px`
    });
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

    // 범위 전환 버튼
    compactUIPopup.find('.dm-scope-btn').on('click', function() {
        setActiveScope($(this).data('scope'));
    });

    compactUIPopup.find('.dm-auto-cycle-btn').on('click', toggleAutoCycleMode);
    compactUIPopup.find('.dm-impersonate-btn').on('click', toggleImpersonateMode);

    compactUIPopup.find('.dm-swap-btn').on('click', function() {
        const scope = getActiveScope();
        setSwapState(!getSwapState(scope), scope);
        applyCharUserMacros();
        updateExtensionMenuUI();
        syncCompactUIPopup();
        saveScopeState(scope);
    });
    
    // 라디오 버튼 변경 이벤트
    compactUIPopup.find('.dm-compact--radio').on('change', function() {
        const page = getCurrentCompactPage();
        if (page.type !== 'single') {
            return;
        }

        const isEnabled = $(this).is(':checked');
        const scope = getActiveScope();
        const settings = getPlaceholderSettings(page.placeholderKey, scope, true);
        
        settings.enabled = isEnabled;
        
        // 텍스트에어리어 활성화/비활성화
        const textarea = compactUIPopup.find('.dm-compact--textarea');
        textarea.prop('disabled', !isEnabled);
        
        applyPlaceholderToSystem(placeholders.find(({ key }) => key === page.placeholderKey));
        updateCompactUIButtonState();
        saveScopeState(scope);
    });
    
    // 지우개 버튼
    compactUIPopup.find('.dm-compact--clear').on('click', function() {
        const page = getCurrentCompactPage();
        if (page.type !== 'single') {
            return;
        }

        const confirmed = confirm('이 플레이스홀더의 내용을 모두 지우시겠습니까?');
        if (confirmed) {
            const scope = getActiveScope();
            const settings = getPlaceholderSettings(page.placeholderKey, scope, true);
            settings.content = "";
            compactUIPopup.find('.dm-compact--textarea').val('');
            applyPlaceholderToSystem(placeholders.find(({ key }) => key === page.placeholderKey));
            saveScopeState(scope);
        }
    });
    
    // 텍스트에어리어 변경 이벤트
    compactUIPopup.on('input', '.dm-compact--textarea', function() {
        const page = getCurrentCompactPage();
        if (page.type !== 'single') {
            return;
        }

        const newContent = $(this).val();
        const scope = getActiveScope();
        const settings = getPlaceholderSettings(page.placeholderKey, scope, true);
        
        settings.content = newContent;
        applyPlaceholderToSystem(placeholders.find(({ key }) => key === page.placeholderKey));
        saveScopeState(scope);
    });

    compactUIPopup.on('change', '.dm-name-enabled', function() {
        const $row = $(this).closest('.dm-name-row');
        const storageKey = String($row.data('storage-key'));
        const isEnabled = $(this).is(':checked');
        const scope = getActiveScope();
        const settings = getPlaceholderSettings(storageKey, scope, true);

        settings.enabled = isEnabled;
        $row.find('.dm-name-input').prop('disabled', !isEnabled);
        applyCharUserMacros();
        updateCompactUIButtonState();
        saveScopeState(scope);
    });

    compactUIPopup.on('input', '.dm-name-input', function() {
        const $row = $(this).closest('.dm-name-row');
        const storageKey = String($row.data('storage-key'));
        const scope = getActiveScope();
        const settings = getPlaceholderSettings(storageKey, scope, true);

        settings.content = $(this).val();
        applyCharUserMacros();
        saveScopeState(scope);
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
        currentPlaceholderIndex = compactPages.length - 1;
    } else if (currentPlaceholderIndex >= compactPages.length) {
        currentPlaceholderIndex = 0;
    }

    syncCompactUIPopup();
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
        <div class="dm-compact--button menu_button" role="button" aria-pressed="false" title="Direction Manager - 전개 지시 꺼짐">
            <i class="fa-solid fa-feather"></i>
            <span class="dm-compact--cycleIndicator" aria-hidden="true">
                <i class="fa-solid fa-rotate"></i>
            </span>
            <span class="dm-compact--swapIndicator" aria-hidden="true">
                <i class="fa-solid fa-right-left"></i>
            </span>
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

    updateCompactUIButtonState();
    
    // 클릭 이벤트
    compactUIButton.on('click', showCompactUIPopup);
}

let impersonateRequestInFlight = false;
let autoCycleAwaitingUserSend = false;

function setImpersonateMode(enabled, { preserveAutoCycle = false } = {}) {
    const settings = extension_settings[extensionName];
    if (!settings) {
        return false;
    }

    settings.impersonateMode = Boolean(enabled);
    if (!settings.impersonateMode && settings.autoCycleMode && !preserveAutoCycle) {
        settings.autoCycleMode = false;
        autoCycleAwaitingUserSend = false;
    }

    syncCompactUIPopup();
    saveSettingsDebounced();
    return settings.impersonateMode;
}

function toggleImpersonateMode() {
    const settings = extension_settings[extensionName];
    if (!settings) {
        return false;
    }

    return setImpersonateMode(!settings.impersonateMode);
}

function toggleAutoCycleMode() {
    const settings = extension_settings[extensionName];
    if (!settings) {
        return false;
    }

    settings.autoCycleMode = !settings.autoCycleMode;
    autoCycleAwaitingUserSend = false;
    if (settings.autoCycleMode) {
        settings.impersonateMode = true;
    }

    syncCompactUIPopup();
    saveSettingsDebounced();
    return settings.autoCycleMode;
}

function handleImpersonateHotkey(event) {
    const isAltE = event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && (event.code === 'KeyE' || String(event.key).toLowerCase() === 'e');

    if (!isAltE) {
        return;
    }

    // Consume WriteSupporter's legacy Alt+E popup shortcut in the capture phase.
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleImpersonateMode();
}

function isImpersonateModeEnabled() {
    const settings = extension_settings[extensionName];
    return Boolean(settings?.extensionEnabled && settings?.impersonateMode);
}

async function runImpersonateFromSendTextarea() {
    if (impersonateRequestInFlight) {
        return;
    }

    const parentDoc = globalThis.parent ? globalThis.parent.document : document;
    const input = String($('#send_textarea', parentDoc).val() ?? '');
    impersonateRequestInFlight = true;

    try {
        const request = {
            text: input,
            handled: false,
        };
        const CustomEventConstructor = parentDoc.defaultView?.CustomEvent;

        if (typeof CustomEventConstructor !== 'function') {
            throw new Error('WriteSupporter 대필 이벤트를 만들 수 없습니다.');
        }

        parentDoc.dispatchEvent(new CustomEventConstructor('writeSupporterImpersonateDirect', {
            detail: request,
        }));

        if (!request.handled) {
            throw new Error('WriteSupporter 대필 리스너를 찾지 못했습니다.');
        }
    } catch (error) {
        console.error(`[${extensionName}] 대필 실행 실패:`, error);
        window.toastr?.error?.('대필 실행에 실패했습니다. 콘솔을 확인해주세요.');
    } finally {
        impersonateRequestInFlight = false;
    }
}

function handleImpersonateSendCapture(event) {
    if (!isImpersonateModeEnabled()) {
        return;
    }

    const sendButton = event.target instanceof Element ? event.target.closest('#send_but') : null;
    if (!sendButton) {
        return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    // 대필 실행 중에는 일반 전송으로 오인되지 않도록 즉시 해제한다.
    const settings = extension_settings[extensionName];
    autoCycleAwaitingUserSend = Boolean(settings.autoCycleMode);
    setImpersonateMode(false, { preserveAutoCycle: true });

    void runImpersonateFromSendTextarea();
}

function handleAutoCycleMessageSent() {
    const settings = extension_settings[extensionName];
    if (!settings?.extensionEnabled || !settings.autoCycleMode || !autoCycleAwaitingUserSend) {
        return;
    }

    autoCycleAwaitingUserSend = false;
    setImpersonateMode(true, { preserveAutoCycle: true });
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
    updateScopeButtons($('#direction_manager_scope'), getActiveScope());
    $('#direction_manager_swap')
        .prop('checked', getSwapState())
        .attr('title', getSwapState() ? '역할 반전 켜짐' : '역할 반전 꺼짐');
    
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
                updateCompactUIButtonState();
            }
            applyAllPlaceholders();
        } else {
            // 확장 비활성화 시: 컴팩트 UI 버튼 숨김 및 모든 매크로 제거
            if (compactUIButton) {
                updateCompactUIButtonState();
                compactUIButton.hide();
                // 팝업이 열려있으면 닫기
                if (compactUIPopup) {
                    closeCompactUIPopup();
                }
            }
            removeAllPlaceholders();
        }
        
        updateCompactUIButtonState();
        saveSettingsDebounced();
    });

    $('#direction_manager_scope .dm-scope-btn').on('click', function() {
        setActiveScope($(this).data('scope'));
    });

    $('#direction_manager_swap').on('change', function() {
        const scope = getActiveScope();
        setSwapState($(this).is(':checked'), scope);

        if (extension_settings[extensionName].extensionEnabled) {
            applyCharUserMacros();
        }

        updateExtensionMenuUI();
        syncCompactUIPopup();
        saveScopeState(scope);
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
    const placeholderStore = getScopePlaceholderStore();
    const messages = eventData.chat || eventData.messages;
    
    // 확장이 비활성화되어 있으면 주입하지 않음
    if (!settings.extensionEnabled) {
        return;
    }

    // WriteSupporter includes the active direction in its own reference block.
    // Skip the ordinary RP direction injection when that marker is present.
    if (Array.isArray(messages) && messages.some(message =>
        String(message?.content ?? '').includes(WRITE_SUPPORTER_DIRECTION_MARKER))) {
        return;
    }
    
    // Direction 토글이 비활성화되어 있으면 주입하지 않음
    if (!placeholderStore.direction.enabled) {
        return;
    }
    
    // 프롬프트가 비어있으면 주입하지 않음
    if (!settings.directionPrompt || settings.directionPrompt.trim() === '') {
        return;
    }
    
    // 플레이스홀더 치환
    let processedPrompt = settings.directionPrompt;
    
    // {{direction}} 플레이스홀더 치환
    if (placeholderStore.direction.content) {
        processedPrompt = processedPrompt.replace(/\{\{direction\}\}/g, placeholderStore.direction.content);
    } else {
        processedPrompt = processedPrompt.replace(/\{\{direction\}\}/g, '');
    }
    
    const macroValues = getCharUserMacroValues(getActiveScope(), false);
    processedPrompt = processedPrompt
        .replace(/\{\{char\}\}/g, String(macroValues.char ?? ''))
        .replace(/\{\{user\}\}/g, String(macroValues.user ?? ''));
    
    const depth = settings.promptDepth || 1;
    
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

    if (extension_settings[extensionName].extensionEnabled) {
        applyAllPlaceholders();
    } else {
        removeAllPlaceholders();
    }
    
    // 확장 메뉴 초기화
    await initializeExtensionMenu();
    
    // 컴팩트 UI 버튼 추가
    addCompactUIButton();

    // 대필 모드에서는 일반 메시지 전송보다 먼저 보내기 클릭을 가로챈다.
    document.addEventListener('keydown', handleImpersonateHotkey, true);
    document.addEventListener('click', handleImpersonateSendCapture, true);
    document.addEventListener(ACTIVE_DIRECTION_REQUEST_EVENT, handleActiveDirectionRequest);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        autoCycleAwaitingUserSend = false;
        if (extension_settings[extensionName].autoCycleMode) {
            extension_settings[extensionName].impersonateMode = true;
        }

        if (extension_settings[extensionName].extensionEnabled) {
            applyAllPlaceholders();
        } else {
            removeAllPlaceholders();
        }

        updateExtensionMenuUI();
        syncCompactUIPopup();
    });

    eventSource.on(event_types.MESSAGE_SENT, handleAutoCycleMessageSent);
    
    // 프롬프트 주입 이벤트 리스너 등록
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, injectDirectionPrompt);
});
