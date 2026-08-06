// ==UserScript==
// @name         TransDesk – крутые яйца
// @description  Мгновенно переводите выделенный текст с помощью умной кнопки или сочетания

// @namespace    TransDesk
// @author       TransDesk
// @copyright    Keydesk team
// @license      Apache-2.0
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      translate.googleapis.com
// @connect      openrouter.ai
// @connect      integrate.api.nvidia.com
// @match        *://*/*
// @run-at       document-start
// @version      2026.1.16
// @icon         https://raw.githubusercontent.com/dozza01/joj/refs/heads/main/icons/trasdesk.png
// @tag          translation
// @tag          text selection
// @tag          translate
// @tag          google translate
// @tag          shortcut
// @tag          productivity
// @tag          accessibility
// @tag          language
// @tag          multilingual

// ==/UserScript==

/*
Copyright 2025-2026 TransDesk

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/



(function () {
    'use strict';

    const UTST_LOGO_URL = 'https://raw.githubusercontent.com/DREwX-code/Ultimate-Text-Selection-Translator/refs/heads/main/assets/icons/Icon_Translate_Script.png';
    // Резервный список бесплатных :free моделей OpenRouter — используется, только
    // если живой запрос к openrouter.ai/api/v1/models ещё не завершился или упал
    // (нет сети, таймаут и т.п.). Основной, всегда актуальный список подтягивается
    // динамически — см. ensureFreeModelsFresh() / getFreeModelIds() ниже.
    const FALLBACK_FREE_MODELS = [
        'google/gemma-4-31b-it:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'google/gemma-4-26b-a4b-it:free',
        'openai/gpt-oss-20b:free',
        'nvidia/nemotron-3-nano-30b-a3b:free',
        'nvidia/nemotron-nano-9b-v2:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'inclusionai/ling-3.0-flash:free',
        'poolside/laguna-s-2.1:free',
        'cohere/north-mini-code:free',
        'openrouter/free'
    ];
    const OPENROUTER_MODELS_CACHE_KEY = 'openRouterFreeModelsCache';
    const OPENROUTER_MODELS_CACHE_TIME_KEY = 'openRouterFreeModelsCacheTime';
    const OPENROUTER_MODELS_CACHE_TTL = 24 * 60 * 60 * 1000; // раз в сутки

    // Список объектов {id, name, context} — из живого кэша (если он есть и не протух),
    // иначе из зашитого резервного списка (в форме {id, name: id}).
    function getFreeModelsList() {
        const cached = GM_getValue(OPENROUTER_MODELS_CACHE_KEY, null);
        if (Array.isArray(cached) && cached.length) return cached;
        return FALLBACK_FREE_MODELS.map(id => ({ id, name: id, context: 0 }));
    }
    function getFreeModelIds() {
        return getFreeModelsList().map(m => m.id);
    }

    function fetchLiveFreeModels(callback) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://openrouter.ai/api/v1/models',
            timeout: 15000,
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const list = (data.data || [])
                        .filter(m => {
                            const id = m.id || '';
                            if (!/:free$/.test(id)) return false;
                            const p = m.pricing || {};
                            const promptFree = parseFloat(p.prompt || '1') === 0;
                            const completionFree = parseFloat(p.completion || '1') === 0;
                            const modalities = (m.architecture && m.architecture.output_modalities) || null;
                            const isTextOut = !modalities || modalities.includes('text');
                            return promptFree && completionFree && isTextOut;
                        })
                        .map(m => ({ id: m.id, name: m.name || m.id, context: m.context_length || 0 }))
                        .sort((a, b) => (b.context || 0) - (a.context || 0));
                    if (list.length) {
                        GM_setValue(OPENROUTER_MODELS_CACHE_KEY, list);
                        GM_setValue(OPENROUTER_MODELS_CACHE_TIME_KEY, Date.now());
                        callback(list, null);
                    } else {
                        callback(null, 'OpenRouter вернул пустой список бесплатных моделей');
                    }
                } catch (e) { callback(null, 'Ошибка разбора ответа: ' + e.message); }
            },
            onerror: function () { callback(null, 'Ошибка сети при обращении к OpenRouter'); },
            ontimeout: function () { callback(null, 'Таймаут при обращении к OpenRouter'); }
        });
    }

    // Обновляет кэш, если он старше суток или отсутствует. callback вызывается
    // в любом случае (со свежим списком, либо, при ошибке — с тем, что уже было).
    function ensureFreeModelsFresh(callback, force) {
        const lastFetch = GM_getValue(OPENROUTER_MODELS_CACHE_TIME_KEY, 0);
        const cached = GM_getValue(OPENROUTER_MODELS_CACHE_KEY, null);
        if (!force && Array.isArray(cached) && cached.length && (Date.now() - lastFetch) < OPENROUTER_MODELS_CACHE_TTL) {
            if (callback) callback(cached, null);
            return;
        }
        fetchLiveFreeModels((list, error) => { if (callback) callback(list || getFreeModelsList(), error); });
    }
    // Перестраивает <option> у выпадающего списка моделей из живого/кэшированного
    // списка, сохраняя текущий выбор пользователя, если он всё ещё доступен.
    function refreshAiModelSelectOptions(selectEl) {
        if (!selectEl) return;
        const list = getFreeModelsList();
        if (!list.length) return;
        const currentValue = selectEl.value || GM_getValue('aiModel', list[0].id);
        selectEl.innerHTML = list.map(m => {
            const ctx = m.context ? ` (${Math.round(m.context / 1000)}K)` : '';
            const label = (m.name || m.id) + ctx;
            return `<option value="${m.id}">${label.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`;
        }).join('');
        const hasCurrent = list.some(m => m.id === currentValue);
        selectEl.value = hasCurrent ? currentValue : list[0].id;
        if (!hasCurrent) GM_setValue('aiModel', selectEl.value);
    }
    // Промпт по умолчанию для генерации подсказки ответа лиду (настройки > Подсказка ответа).
    const DEFAULT_REPLY_SUGGESTION_PROMPT = 'You are a helpful support/sales agent. A lead/client wrote the following message (it may be in any language). Write a short, polite, ready-to-send reply in {target_lang}. If a reference template is provided below, adapt it to fit this specific message instead of writing generic text. Output ONLY the reply text, no explanations or quotes.\n\nReference template (may be empty): {template}';

    // ===== NVIDIA (build.nvidia.com / NIM) — второй провайдер ИИ, OpenAI-совместимый API =====
    const NVIDIA_MODEL_PRESETS = [
        { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'NVIDIA Llama 3.1 Nemotron 70B' },
        { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', name: 'NVIDIA Llama 3.3 Nemotron Super 49B' },
        { id: 'meta/llama-3.3-70b-instruct', name: 'Meta Llama 3.3 70B (через NVIDIA)' },
        { id: 'meta/llama-3.1-405b-instruct', name: 'Meta Llama 3.1 405B (через NVIDIA)' },
        { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B (через NVIDIA)' },
        { id: 'qwen/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B (через NVIDIA)' },
        { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1 (через NVIDIA)' },
        { id: 'nvidia/nemotron-4-340b-instruct', name: 'NVIDIA Nemotron 4 340B' }
    ];
    function getNvidiaModelsList() {
        const cached = GM_getValue('nvidiaModelsCache', null);
        return (Array.isArray(cached) && cached.length) ? cached : NVIDIA_MODEL_PRESETS;
    }
    function getNvidiaModelIds() {
        return getNvidiaModelsList().map(m => m.id);
    }
    function refreshNvidiaModelSelectOptions(selectEl) {
        if (!selectEl) return;
        const list = getNvidiaModelsList();
        if (!list.length) return;
        const currentValue = selectEl.value || GM_getValue('nvidiaModel', list[0].id);
        selectEl.innerHTML = list.map(m => {
            const label = m.name || m.id;
            return `<option value="${m.id}">${String(label).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</option>`;
        }).join('');
        const hasCurrent = list.some(m => m.id === currentValue);
        selectEl.value = hasCurrent ? currentValue : list[0].id;
        if (!hasCurrent) GM_setValue('nvidiaModel', selectEl.value);
    }
    function fetchLiveNvidiaModels(apiKey, callback) {
        if (!apiKey) { callback(null, 'Сначала укажите API ключ NVIDIA.'); return; }
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://integrate.api.nvidia.com/v1/models',
            timeout: 15000,
            headers: { 'Authorization': `Bearer ${apiKey}` },
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const list = (data.data || [])
                        .map(m => ({ id: m.id, name: m.id }))
                        .filter(m => m.id);
                    if (list.length) {
                        GM_setValue('nvidiaModelsCache', list);
                        callback(list, null);
                    } else {
                        callback(null, 'NVIDIA вернула пустой список моделей');
                    }
                } catch (e) { callback(null, 'Ошибка разбора ответа: ' + e.message); }
            },
            onerror: function () { callback(null, 'Ошибка сети при обращении к NVIDIA'); },
            ontimeout: function () { callback(null, 'Таймаут при обращении к NVIDIA'); }
        });
    }
    function requestNvidiaCompletion(model, apiKey, prompt, text, callback) {
        GM_xmlhttpRequest({
            method: 'POST', url: 'https://integrate.api.nvidia.com/v1/chat/completions',
            timeout: 25000,
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
            data: JSON.stringify({ model: model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }], temperature: 0.3, max_tokens: 1024 }),
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data.choices && data.choices[0] && data.choices[0].message) { callback({ ok: true, text: data.choices[0].message.content.trim() }); return; }
                    if (data.error) { callback({ ok: false, error: data.error.message || data.error.detail || 'Ошибка NVIDIA API' }); return; }
                    if (data.title || data.detail) { callback({ ok: false, error: `${data.title || 'Ошибка NVIDIA'}${data.detail ? ': ' + data.detail : ''}` }); return; }
                    callback({ ok: false, error: 'Неверный формат ответа NVIDIA' });
                } catch (e) { callback({ ok: false, error: 'Ошибка парсинга ответа NVIDIA: ' + e.message }); }
            },
            onerror: function () { callback({ ok: false, error: 'Ошибка соединения с NVIDIA API' }); },
            ontimeout: function () { callback({ ok: false, error: 'Таймаут ответа от NVIDIA API' }); }
        });
    }
    let utstLogoPreloadImage = null;
    let utstLogoLoaded = false;

    function preloadUtstLogo() {
        if (utstLogoPreloadImage || typeof Image !== 'function') return;
        utstLogoPreloadImage = new Image();
        utstLogoPreloadImage.decoding = 'async';
        utstLogoPreloadImage.referrerPolicy = 'no-referrer';
        if ('fetchPriority' in utstLogoPreloadImage) {
            utstLogoPreloadImage.fetchPriority = 'low';
        }
        utstLogoPreloadImage.onload = () => {
            utstLogoLoaded = true;
            window.dispatchEvent(new CustomEvent('utst-logo-loaded'));
        };
        utstLogoPreloadImage.src = UTST_LOGO_URL;
    }

    function scheduleUtstLogoPreload() {
        const runWhenIdle = () => {
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(preloadUtstLogo, { timeout: 3000 });
            } else {
                window.setTimeout(preloadUtstLogo, 800);
            }
        };

        if (document.readyState === 'complete') {
            window.setTimeout(runWhenIdle, 0);
        } else {
            window.addEventListener('load', runWhenIdle, { once: true });
        }
    }

    scheduleUtstLogoPreload();

    function bootstrap() {

    // ===== ВСТРОЕННАЯ БИБЛИОТЕКА (вместо @require) =====
    const utstSupportedUiLanguages = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'zh-CN', 'ja', 'ar', 'hi', 'ko', 'tr', 'nl', 'pl', 'id', 'vi', 'uk', 'he'];
    const utstLanguageNames = {
        'en': { 'auto': 'Detect', 'en': 'English', 'fr': 'French', 'es': 'Spanish', 'de': 'German', 'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'zh-CN': 'Chinese (Simplified)', 'ja': 'Japanese', 'ar': 'Arabic', 'hi': 'Hindi', 'ko': 'Korean', 'tr': 'Turkish', 'nl': 'Dutch', 'pl': 'Polish', 'id': 'Indonesian', 'vi': 'Vietnamese', 'uk': 'Ukrainian', 'he': 'Hebrew', 'errors': { 'noText': 'No text selected', 'translation': 'Translation error', 'connection': 'Connection error' }, 'tooltips': { 'listenTranslated': 'Listen to translated text', 'listenOriginal': 'Listen to original text' }, 'themes': { 'blue': 'Blue', 'dark': 'Dark', 'light': 'Light' }, 'bubble': { 'hideSite': 'Hide on this site', 'hideGlobal': 'Hide globally', 'closeTitle': 'Hide selection bubble', 'translateTitle': 'Translate selected text', 'hideOn': 'Hide on' }, 'overlay': { 'title': 'Fullscreen Translator', 'source': 'Source text', 'target': 'Translated text', 'translate': 'Translate', 'open': 'Fullscreen', 'sourceLangLabel': 'Source language', 'targetLangLabel': 'Target language' }, 'dragHandleLabel': 'Move', 'settingsTitle': 'Settings', 'settingsDefaultLabel': 'Default translation language:', 'settingsToolLabel': 'Tool language:', 'navigator': 'Browser language', 'settingsThemeLabel': 'Theme:', 'settingsBubbleLabel': 'Selection Bubble', 'settingsBlacklistLabel': 'Blacklist', 'settingsBlacklistAdd': 'Add', 'settingsBlacklistEmpty': 'No blocked sites.', 'settingsShortcutLabel': 'Shortcut:', 'settingsShortcutListening': 'Press keys...', 'settingsShortcutHelp': 'Click, then press a combination with Ctrl, Alt, Shift, or Cmd.', 'settingsShortcutInvalid': 'Add at least Ctrl, Alt, Shift, or Cmd.', 'settingsShortcutSaved': 'Shortcut saved.', 'settingsShortcutReset': 'Reset shortcut' },
        'ru': { 'auto': 'Определить', 'en': 'Английский', 'fr': 'Французский', 'es': 'Испанский', 'de': 'Немецкий', 'it': 'Итальянский', 'pt': 'Португальский', 'ru': 'Русский', 'zh-CN': 'Китайский (упрощённый)', 'ja': 'Японский', 'ar': 'арабский', 'hi': 'хинди', 'ko': 'корейский', 'tr': 'турецкий', 'nl': 'нидерландский', 'pl': 'польский', 'id': 'индонезийский', 'vi': 'вьетнамский', 'uk': 'украинский', 'he': 'иврит', 'errors': { 'noText': 'Текст не выделен', 'translation': 'Ошибка перевода', 'connection': 'Ошибка соединения' }, 'tooltips': { 'listenTranslated': 'Прослушать переведённый текст', 'listenOriginal': 'Прослушать оригинальный текст' }, 'themes': { 'blue': 'Синий', 'dark': 'Тёмный', 'light': 'Светлый' }, 'bubble': { 'hideSite': 'Скрыть на этом сайте', 'hideGlobal': 'Скрыть везде', 'closeTitle': 'Скрыть пузырь выделения', 'translateTitle': 'Перевести выделенный текст', 'hideOn': 'Скрыть на' }, 'overlay': { 'title': 'Полноэкранный переводчик', 'source': 'Исходный текст', 'target': 'Переведенный текст', 'translate': 'Перевожу', 'open': 'Полноэкранный', 'sourceLangLabel': 'Исходный язык', 'targetLangLabel': 'Целевой язык' }, 'dragHandleLabel': 'Переместить', 'settingsTitle': 'Настройки', 'settingsDefaultLabel': 'Язык перевода по умолчанию:', 'settingsToolLabel': 'Язык интерфейса:', 'navigator': 'Язык браузера', 'settingsThemeLabel': 'Тема:', 'settingsBubbleLabel': 'Пузырь выбора', 'settingsBlacklistLabel': 'Черный список', 'settingsBlacklistAdd': 'Добавлять', 'settingsBlacklistEmpty': 'Никаких заблокированных сайтов.', 'settingsShortcutLabel': 'Сочетание клавиш:', 'settingsShortcutListening': 'Нажмите клавиши...', 'settingsShortcutHelp': 'Нажмите, затем введите сочетание с Ctrl, Alt, Shift или Cmd.', 'settingsShortcutInvalid': 'Добавьте хотя бы Ctrl, Alt, Shift или Cmd.', 'settingsShortcutSaved': 'Сочетание сохранено.', 'settingsShortcutReset': 'Сбросить сочетание' }
    };
    ['ar', 'hi', 'ko', 'tr', 'nl', 'pl', 'id', 'vi', 'uk', 'he', 'fr', 'es', 'de', 'it', 'pt', 'zh-CN', 'ja'].forEach(lang => {
        if (!utstLanguageNames[lang]) utstLanguageNames[lang] = { ...utstLanguageNames['en'], auto: lang };
    });
    window.TraductionOutilTranslator = { supportedUiLanguages: utstSupportedUiLanguages, languageNames: utstLanguageNames };
    // ======================================================

        const UTST_STYLE_TEXT = `
            :host {
                all: initial !important;
                position: static !important;
                display: contents !important;
                color-scheme: normal !important;
                forced-color-adjust: none !important;
                font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
            }

            :host *,
            :host *::before,
            :host *::after {
                box-sizing: border-box !important;
            }

            #closeButton:hover svg {
                stroke: #ff4d4d !important;
                filter: drop-shadow(0 0 4px rgba(255, 77, 77, 0.5));
                transform: scale(1.1);
                transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }

            .utst-header-logo {
                width: 18px !important;
                height: 18px !important;
                min-width: 18px !important;
                display: block !important;
                object-fit: contain !important;
                pointer-events: none !important;
                user-select: none !important;
                flex: 0 0 18px !important;
                filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.28)) !important;
            }

            #fullscreenTitleWrap {
                display: flex !important;
                align-items: center !important;
                gap: 8px !important;
                min-width: 0 !important;
            }

            @keyframes utst-shimmer {
                0% { background-position: -468px 0; }
                100% { background-position: 468px 0; }
            }

            .utst-loading {
                position: relative !important;
                overflow: hidden !important;
                pointer-events: none !important;
            }

            .utst-loading::after {
                content: "" !important;
                position: absolute !important;
                inset: 0 !important;
                background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0) 100%) !important;
                background-size: 468px 100% !important;
                animation: utst-shimmer 1.5s infinite linear !important;
                z-index: 5 !important;
            }

            .utst-panel-light .utst-loading::after {
                background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(0,0,0,0.05) 50%, rgba(255,255,255,0) 100%) !important;
            }

            .utst-loading-overlay {
                position: absolute !important;
                inset: 0 !important;
                background: rgba(0, 0, 0, 0.2) !important;
                backdrop-filter: blur(2px) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-radius: 10px !important;
                z-index: 10 !important;
                pointer-events: none !important;
                opacity: 0 !important;
                transition: opacity 0.3s ease !important;
            }

            .utst-loading-active .utst-loading-overlay {
                opacity: 1 !important;
            }

            .utst-loading-shimmer {
                width: 100% !important;
                height: 100% !important;
                background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0) 100%) !important;
                background-size: 468px 100% !important;
                animation: utst-shimmer 1.5s infinite linear !important;
            }

            .utst-panel-light .utst-loading-shimmer {
                background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(0,0,0,0.06) 50%, rgba(255,255,255,0) 100%) !important;
            }

            .utst-scroll {
                scrollbar-width: thin !important;
                scrollbar-color: rgba(100, 149, 237, 0.5) rgba(0, 0, 0, 0.1) !important;
            }

            .utst-scroll::-webkit-scrollbar {
                width: 6px !important;
                height: 6px !important;
            }

            .utst-scroll::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.05) !important;
                border-radius: 3px !important;
            }

            .utst-scroll::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.15) !important;
                border-radius: 3px !important;
                border: 1px solid rgba(255, 255, 255, 0.05) !important;
            }

            .utst-scroll::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.3) !important;
            }

            #utstSelectionBubble {
                position: absolute;
                top: 0;
                left: 0;
                z-index: 2147483647;
                display: flex;
                align-items: center;
                gap: 0;
                height: 40px;
                padding: 0 6px;
                border-radius: 20px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                background: rgba(25, 25, 35, 0.85); /* Dark semi-transparent */
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                color: #fff;
                opacity: 0;
                transform: translateY(-8px) scale(0.95);
                pointer-events: none;
                transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                font-family: 'Roboto', sans-serif;
                box-sizing: border-box !important;
            }

            #utstTranslationBox,
            #utstTranslationBox * {
                box-sizing: border-box !important;
            }

            #utstTranslationBox,
            #fullscreenOverlay,
            #utstSelectionBubble,
            .utst-inline-lang-panel {
                font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
                font-size: 14px !important;
                line-height: 1.35 !important;
                letter-spacing: normal !important;
                text-transform: none !important;
                text-size-adjust: 100% !important;
                -webkit-text-size-adjust: 100% !important;
                direction: ltr !important;
                writing-mode: horizontal-tb !important;
                zoom: 1 !important;
                isolation: isolate !important;
            }

            #fullscreenOverlay,
            #fullscreenOverlay *,
            #utstSelectionBubble,
            #utstSelectionBubble *,
            .utst-inline-lang-panel,
            .utst-inline-lang-panel * {
                box-sizing: border-box !important;
                text-transform: none !important;
                letter-spacing: normal !important;
            }

            #fullscreenOverlay {
                overflow: auto !important;
            }

            #fullscreenPanel {
                width: min(1100px, 95vw) !important;
                max-width: 95vw !important;
                max-height: 92vh !important;
                overflow: auto !important;
                box-sizing: border-box !important;
            }

            #fullscreenColumns {
                min-width: 0 !important;
            }

            #fullscreenColumns > div {
                min-width: 0 !important;
            }

            #fullscreenSource,
            #fullscreenTarget,
            #fullscreenSourceWrap,
            #fullscreenTargetWrap {
                width: 100% !important;
                max-width: 100% !important;
                min-width: 0 !important;
            }

            #fullscreenSource,
            #fullscreenTarget {
                min-height: 200px !important;
                max-height: min(62vh, 560px) !important;
                resize: vertical !important;
                box-sizing: border-box !important;
            }

            #fullscreenSourceWrap,
            #fullscreenTargetWrap {
                box-sizing: border-box !important;
            }

            #backButton {
                width: 20px !important;
                height: 20px !important;
                min-width: 20px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                line-height: 0 !important;
                flex: 0 0 20px !important;
            }

            #backButton svg {
                width: 20px !important;
                height: 20px !important;
                display: block !important;
                flex: 0 0 20px !important;
            }

            #utstTranslationBox {
                width: min(420px, calc(100vw - 20px)) !important;
                min-width: min(420px, calc(100vw - 20px)) !important;
                max-width: min(420px, calc(100vw - 20px)) !important;
            }

            #utstTranslationBox select,
            #utstTranslationBox option {
                -webkit-appearance: menulist !important;
                -moz-appearance: menulist !important;
                appearance: auto !important;
                background-image: none !important;
                font-family: inherit !important;
                font-size: 13px !important;
                line-height: 1.2 !important;
                color: #fff !important;
            }

            #utstTranslationBox select {
                padding-right: 24px !important;
                min-height: 30px !important;
            }

            #utstSelectionBubble.utst-visible {
                opacity: 1;
                transform: translateY(0) scale(1);
                pointer-events: auto;
            }

            #utstSelectionBubbleClose {
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                color: rgba(255, 255, 255, 0.7);
                background: transparent;
                font-size: 16px;
                font-weight: 500;
                line-height: 1;
                transition: all 0.2s ease;
                cursor: pointer;
                user-select: none;
                margin-right: 2px;
            }

            #utstSelectionBubbleClose:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
                transform: rotate(90deg);
            }

            #utstSelectionBubbleDivider {
                width: 1px;
                height: 20px;
                margin: 0 6px;
                background: rgba(255, 255, 255, 0.2);
            }

            #utstSelectionBubbleAction {
                width: 30px;
                height: 30px;
                border: 0;
                border-radius: 50%;
                padding: 0;
                background: transparent;
                color: #fff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            #utstSelectionBubbleAction svg {
                width: 18px;
                height: 18px;
                color: #d8e8ff;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
            }

            #utstSelectionBubbleAction:hover {
                background: rgba(255, 255, 255, 0.15);
                transform: scale(1.1);
            }

            #speakTooltip .utst-speak-option:hover {
                background: rgba(255,255,255,0.12);
            }

            #panelThemeCurrent,
            .utst-theme-option-label {
                display: inline-flex !important;
                align-items: center !important;
                gap: 9px !important;
                min-width: 0 !important;
            }

            #panelThemeCurrent span:last-child,
            .utst-theme-option-label span:last-child {
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
            }

            .utst-theme-swatch {
                width: 16px !important;
                height: 10px !important;
                min-width: 16px !important;
                border-radius: 4px !important;
                border: 1px solid var(--utst-theme-swatch-border, rgba(255, 255, 255, 0.24)) !important;
                background: var(--utst-theme-swatch-bg, #2563eb) !important;
                box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08) !important;
            }

            #fullscreenSwap {
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }

            #fullscreenSwap:hover,
            #fullscreenSwap:active {
                background: transparent !important;
                box-shadow: none !important;
            }

            #utstBubbleCloseMenu {
                position: absolute;
                left: 0;
                top: calc(100% + 10px);
                display: none;
                flex-direction: column;
                min-width: 180px;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                background: rgba(30, 30, 40, 0.95);
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                overflow: hidden;
                animation: utstFadeIn 0.2s ease;
            }

            @keyframes utstFadeIn {
                from { opacity: 0; transform: translateY(-5px); }
                to { opacity: 1; transform: translateY(0); }
            }

            #utstBubbleCloseMenu.utst-open {
                display: flex;
            }

            .utst-bubble-menu-btn {
                border: 0;
                background: transparent;
                color: rgba(255, 255, 255, 0.9);
                text-align: left;
                font-size: 13px;
                padding: 10px 14px;
                cursor: pointer;
                transition: background 0.15s ease;
                font-family: inherit;
            }

            .utst-bubble-menu-btn:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }

            .utst-bubble-settings {
                margin-top: 14px;
                padding-top: 14px;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }

            #utstTranslationBox #settingsHeader {
                padding: 4px 8px;
                border-radius: 10px;
                background: #222b3f;
                border: 1px solid rgba(255, 255, 255, 0.08);
                right: 8px;
                z-index: 14;
            }

            #utstTranslationBox #settingsPanel {
                position: absolute;
                top: 62px;
                left: 8px;
                right: 8px;
                bottom: 10px;
                z-index: 13;
                margin: 0;
                min-width: 0 !important;
                max-width: none !important;
                min-height: 0 !important;
                max-height: none !important;
                overflow-y: auto;
                border-radius: 10px;
                background: transparent;
            }

            #utstTranslationBox #translatorPanel {
                transition: filter 0.18s ease, opacity 0.18s ease;
            }

            #utstTranslationBox #translationTextWrap,
            #fullscreenPanel #fullscreenTargetWrap {
                position: relative;
            }

            .utst-modern-loader {
                position: absolute;
                inset: 0;
                display: none;
                align-items: center;
                justify-content: center;
                border-radius: 10px;
                background: linear-gradient(135deg, rgba(12, 20, 36, 0.7) 0%, rgba(16, 28, 50, 0.62) 100%);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                opacity: 0;
                pointer-events: none;
                transform: scale(0.985);
                transition: opacity 0.2s ease, transform 0.2s ease;
                z-index: 9;
            }

            .utst-modern-loader.is-active {
                display: flex;
                opacity: 1;
                pointer-events: auto;
                transform: scale(1);
            }

            .utst-modern-loader__card {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 170px;
                max-width: calc(100% - 20px);
                padding: 10px 12px;
                border-radius: 12px;
                border: 1px solid rgba(255, 255, 255, 0.18);
                background: rgba(8, 14, 28, 0.64);
                box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);
            }

            .utst-modern-loader__ring {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-top-color: #7bb1ff;
                animation: utstLoaderSpin 0.8s linear infinite;
                flex: none;
            }

            .utst-modern-loader[data-mode="language"] .utst-modern-loader__ring {
                border-top-color: #4fd0a9;
            }

            .utst-modern-loader__body {
                display: flex;
                flex-direction: column;
                gap: 6px;
                min-width: 105px;
            }

            .utst-modern-loader__title {
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 0.2px;
                color: rgba(245, 248, 255, 0.95);
                line-height: 1.2;
                white-space: nowrap;
            }

            .utst-modern-loader__line {
                width: 100%;
                height: 6px;
                border-radius: 999px;
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.4) 48%, rgba(255, 255, 255, 0.14) 100%);
                background-size: 180% 100%;
                animation: utstLoaderShimmer 1.1s linear infinite;
            }

            html.utst-theme-dark .utst-modern-loader {
                background: linear-gradient(135deg, rgba(10, 10, 10, 0.78) 0%, rgba(20, 20, 20, 0.78) 100%) !important;
            }

            html.utst-theme-dark .utst-modern-loader__card {
                background: rgba(16, 16, 16, 0.74) !important;
                border-color: rgba(255, 255, 255, 0.14) !important;
                box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45) !important;
            }

            html.utst-theme-dark .utst-modern-loader__ring {
                border-color: rgba(255, 255, 255, 0.16) !important;
                border-top-color: #d0d0d0 !important;
            }

            html.utst-theme-dark .utst-modern-loader[data-mode="language"] .utst-modern-loader__ring {
                border-top-color: #55c89a !important;
            }

            html.utst-theme-dark .utst-modern-loader__title {
                color: rgba(245, 245, 245, 0.94) !important;
            }

            html.utst-theme-dark .utst-modern-loader__line {
                background: linear-gradient(90deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.32) 50%, rgba(255, 255, 255, 0.1) 100%) !important;
            }

            @keyframes utstLoaderSpin {
                to { transform: rotate(360deg); }
            }

            @keyframes utstLoaderShimmer {
                from { background-position: 180% 0; }
                to { background-position: -80% 0; }
            }

            #utstTranslationBox.utst-settings-open #translatorPanel {
                filter: blur(4px) saturate(0.9);
                opacity: 0.34;
                pointer-events: none;
                user-select: none;
            }

            .utst-toggle-row {
                display: flex;
                align-items: center;
                gap: 10px;
                color: rgba(255, 255, 255, 0.9);
                font-size: 13px;
                margin-bottom: 10px;
                user-select: none;
                cursor: pointer;
            }

            .utst-toggle-row input[type="checkbox"] {
                appearance: none;
                width: 36px;
                height: 20px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 20px;
                position: relative;
                cursor: pointer;
                transition: background 0.2s;
                border: 1px solid rgba(255, 255, 255, 0.1);
            }

            .utst-toggle-row input[type="checkbox"]::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 2px;
                width: 14px;
                height: 14px;
                background: #fff;
                border-radius: 50%;
                transition: transform 0.2s;
                box-shadow: 0 1px 3px rgba(0,0,0,0.3);
            }

            .utst-toggle-row input[type="checkbox"]:checked {
                background: #4a90e2;
                border-color: #4a90e2;
            }

            .utst-toggle-row input[type="checkbox"]:checked::after {
                transform: translateX(16px);
            }

            .utst-blacklist-controls {
                display: flex;
                gap: 8px;
                margin-top: 8px;
            }

            .utst-blacklist-input {
                flex: 1;
                min-width: 0;
                box-sizing: border-box;
                padding: 8px 10px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.15);
                background: rgba(0, 0, 0, 0.2);
                color: #fff;
                font-size: 12px;
                font-family: inherit;
                transition: border-color 0.2s;
            }

            .utst-blacklist-input:focus {
                outline: none;
                border-color: #4a90e2;
            }

            #utstTranslationBox select:focus,
            #utstTranslationBox select:focus-visible {
                outline: none !important;
                box-shadow: none !important;
            }

            .utst-blacklist-add {
                border: none;
                border-radius: 8px;
                background: #4a90e2;
                color: #fff;
                font-size: 12px;
                font-weight: 600;
                padding: 0 12px;
                cursor: pointer;
                transition: background 0.2s;
            }

            .utst-blacklist-add:hover {
                background: #357abd;
            }

            .utst-blacklist-list {
                margin-top: 10px;
                max-height: 120px;
                overflow-y: auto;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                padding: 8px;
                background: rgba(0, 0, 0, 0.15);
            }

            .utst-blacklist-item {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                font-size: 12px;
                color: rgba(255, 255, 255, 0.9);
                padding: 6px 8px;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.03);
                transition: background 0.1s;
            }

            .utst-blacklist-item:hover {
                background: rgba(255, 255, 255, 0.08);
            }

            .utst-blacklist-item + .utst-blacklist-item {
                margin-top: 4px;
            }

            .utst-blacklist-remove {
                border: none;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.1);
                color: rgba(255, 255, 255, 0.7);
                width: 20px;
                height: 20px;
                line-height: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.2s;
            }

            .utst-blacklist-remove:hover {
                background: rgba(255, 77, 77, 0.2);
                color: #ff4d4d;
            }

            .utst-blacklist-empty {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.5);
                padding: 4px;
                text-align: center;
            }

            .utst-shortcut-control {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
                max-width: 260px;
                margin: 0 auto;
            }

            .utst-shortcut-capture {
                flex: 1;
                min-width: 0;
                height: 32px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.18);
                background: rgba(255, 255, 255, 0.08);
                color: #fff;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                font-family: inherit;
            }

            .utst-shortcut-capture.is-recording {
                border-color: #4a90e2;
                box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.22);
            }

            .utst-shortcut-reset {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                border: 1px solid rgba(255, 255, 255, 0.16);
                background: rgba(255, 255, 255, 0.06);
                color: #fff;
                font-size: 15px;
                line-height: 1;
                cursor: pointer;
                font-family: inherit;
            }

            .utst-shortcut-help {
                width: 100%;
                max-width: 260px;
                margin: 5px auto 0;
                min-height: 14px;
                color: rgba(255, 255, 255, 0.58);
                font-size: 11px;
                line-height: 1.25;
            }

            html.utst-theme-blue #utstSelectionBubble {
                /* Muted deep blue, inspired by the panel but less saturated/flashy */
                background: linear-gradient(135deg, rgba(30, 30, 47, 0.96) 0%, rgba(35, 35, 52, 0.96) 100%);
                border-color: rgba(255, 255, 255, 0.15);
                box-shadow: 0 8px 25px rgba(10, 14, 28, 0.5);
            }

            html.utst-theme-blue #utstSelectionBubbleDivider {
                background: rgba(255, 255, 255, 0.2);
            }

            html.utst-theme-blue #utstSelectionBubbleAction svg,
            html.utst-theme-blue #utstSelectionBubbleClose {
                color: #eaf2ff;
            }

            html.utst-theme-blue #utstTranslationBox {
                background: linear-gradient(135deg, #1e1e2f 0%, #2a2a4a 100%) !important;
                border-color: rgba(255, 255, 255, 0.10) !important;
                color: #ffffff !important;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45) !important;
            }

            html.utst-theme-blue #utstTranslationBox #dragHandle {
                background: linear-gradient(120deg, #1b1b2d, #262645) !important;
                color: #ffffff !important;
                box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.10) !important;
            }

            html.utst-theme-blue #utstTranslationBox #translationText {
                background: rgba(255, 255, 255, 0.06) !important;
                border: 1px solid rgba(255, 255, 255, 0.16) !important;
                color: #ffffff !important;
            }

            html.utst-theme-blue #utstTranslationBox select,
            html.utst-theme-blue #utstTranslationBox input,
            html.utst-theme-blue #utstTranslationBox .utst-shortcut-capture,
            html.utst-theme-blue #utstTranslationBox .utst-shortcut-reset {
                background: rgba(255, 255, 255, 0.08) !important;
                border-color: rgba(255, 255, 255, 0.14) !important;
                color: #ffffff !important;
            }

            html.utst-theme-blue #utstTranslationBox .utst-bubble-settings {
                border-top-color: rgba(255, 255, 255, 0.14) !important;
            }

            html.utst-theme-blue #utstTranslationBox .utst-toggle-row input[type="checkbox"] {
                background: rgba(255, 255, 255, 0.10) !important;
                border-color: rgba(255, 255, 255, 0.16) !important;
            }

            html.utst-theme-blue #utstTranslationBox .utst-toggle-row input[type="checkbox"]:checked {
                background: #4a90e2 !important;
                border-color: #8bb1ff !important;
                box-shadow: 0 0 0 2px rgba(74, 144, 226, 0.18) !important;
            }

            html.utst-theme-dark #utstSelectionBubble {
                background: linear-gradient(135deg, rgba(18, 18, 18, 0.96) 0%, rgba(28, 28, 28, 0.96) 100%) !important;
                border-color: rgba(255, 255, 255, 0.08) !important;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.6) !important;
            }

            html.utst-theme-dark #utstSelectionBubbleDivider {
                background: rgba(255, 255, 255, 0.15) !important;
            }

            html.utst-theme-dark #utstSelectionBubbleAction svg,
            html.utst-theme-dark #utstSelectionBubbleClose {
                color: #d0d0d0 !important;
            }

            html.utst-theme-dark #utstTranslationBox {
                /* True neutral dark, removing blue tint */
                background: linear-gradient(135deg, #121212 0%, #1e1e1e 100%) !important;
                border-color: rgba(255,255,255,0.08) !important;
            }

            html.utst-theme-dark #utstTranslationBox #dragHandle {
                background: linear-gradient(120deg, #1a1a1a, #252525) !important;
            }

            html.utst-theme-dark #fullscreenPanel {
                background: linear-gradient(135deg, #121212 0%, #1e1e1e 100%) !important;
                border-color: rgba(255,255,255,0.08) !important;
            }

            html.utst-theme-blue #utstTranslationBox #settingsHeader {
                background: rgba(30, 30, 47, 0.78) !important;
                border-color: rgba(255, 255, 255, 0.14) !important;
            }

            html.utst-theme-blue #utstTranslationBox #settingsPanel {
                background: transparent !important;
            }

            html.utst-theme-dark #utstTranslationBox #settingsHeader {
                background: #1a1a1a !important;
                border-color: rgba(255, 255, 255, 0.14) !important;
            }

            html.utst-theme-dark #utstTranslationBox #settingsPanel {
                background: transparent !important;
            }

            html.utst-theme-light #utstSelectionBubble {
                /* Softer, less blinding white - slightly grey/blue tinted off-white */
                background: linear-gradient(135deg, #f0f2f5 0%, #e1e4e8 100%) !important;
                border-color: rgba(0, 0, 0, 0.1) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08) !important;
            }

            html.utst-theme-light #utstSelectionBubbleDivider {
                background: rgba(0, 0, 0, 0.1) !important;
            }

            html.utst-theme-light #utstSelectionBubbleAction svg,
            html.utst-theme-light #utstSelectionBubbleClose {
                color: #4a5568 !important; /* Dark grey-blue */
            }

            html.utst-theme-light #utstBubbleCloseMenu {
                background: rgba(255, 255, 255, 0.98) !important;
                border-color: rgba(0, 0, 0, 0.1) !important;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
            }

            html.utst-theme-light .utst-bubble-menu-btn {
                color: #2d3748 !important;
            }

            html.utst-theme-light .utst-bubble-menu-btn:hover {
                background: rgba(0, 0, 0, 0.05) !important;
            }

            html.utst-theme-light #utstTranslationBox {
                /* Softer light theme background */
                background: linear-gradient(135deg, #ffffff 0%, #f7f9fc 100%) !important;
                border-color: rgba(0, 0, 0, 0.08) !important;
                color: #1a202c !important;
                box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12) !important;
            }

            html.utst-theme-light #utstTranslationBox #dragHandle {
                background: linear-gradient(120deg, #edf2f7, #e2e8f0) !important;
                color: #4a5568 !important;
                box-shadow: inset 0 -1px 0 rgba(0,0,0,0.05) !important;
            }

            html.utst-theme-light #utstTranslationBox #dragHandle > div {
                background: rgba(74, 85, 104, 0.45) !important;
            }

            /* Ensure ALL icons in the box are dark in light theme */
            html.utst-theme-light #utstTranslationBox svg {
                stroke: #4a5568;
            }
            /* Keep specific icon colors if needed, e.g. close button might be red */
            html.utst-theme-light #utstTranslationBox #closeButton svg {
                stroke: #ef4444 !important;
            }

            html.utst-theme-light #utstTranslationBox #settingsButton svg path {
                stroke: #4a5568 !important;
            }

            html.utst-theme-light #utstTranslationBox #translatorPanel *,
            html.utst-theme-light #utstTranslationBox #settingsPanel *,
            html.utst-theme-light #utstTranslationBox #settingsHeader *,
            html.utst-theme-light #fullscreenPanel * {
                color: #2d3748 !important;
            }

            html.utst-theme-light #utstTranslationBox #translationText {
                background: #f7fafc !important;
                border: 1px solid #e2e8f0 !important;
                color: #1a202c !important;
            }

            html.utst-theme-light .utst-modern-loader {
                background: linear-gradient(135deg, rgba(241, 245, 249, 0.78) 0%, rgba(226, 232, 240, 0.78) 100%) !important;
            }

            html.utst-theme-light .utst-modern-loader__card {
                background: rgba(255, 255, 255, 0.9) !important;
                border-color: rgba(148, 163, 184, 0.45) !important;
                box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12) !important;
            }

            html.utst-theme-light .utst-modern-loader__ring {
                border-color: rgba(71, 85, 105, 0.2) !important;
                border-top-color: #2563eb !important;
            }

            html.utst-theme-light .utst-modern-loader[data-mode="language"] .utst-modern-loader__ring {
                border-top-color: #0f9f6e !important;
            }

            html.utst-theme-light .utst-modern-loader__title {
                color: #1e293b !important;
            }

            html.utst-theme-light .utst-modern-loader__line {
                background: linear-gradient(90deg, rgba(30, 41, 59, 0.08) 0%, rgba(37, 99, 235, 0.28) 50%, rgba(30, 41, 59, 0.08) 100%) !important;
            }

            html.utst-theme-light #utstTranslationBox select,
            html.utst-theme-light #utstTranslationBox input {
                background: #ffffff !important;
                border: 1px solid #cbd5e0 !important;
                color: #2d3748 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-toggle-row input[type="checkbox"] {
                background: #d9e1ec !important;
                border: 1px solid #b8c4d6 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-toggle-row input[type="checkbox"]::after {
                background: #ffffff !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-toggle-row input[type="checkbox"]:checked {
                background: #4a90e2 !important;
                border-color: #4a90e2 !important;
            }

            html.utst-theme-light #utstTranslationBox #bubbleBlacklistList {
                background: #ffffff !important;
                border-color: #e2e8f0 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-blacklist-item {
                background: #f7fafc !important;
                color: #2d3748 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-blacklist-empty {
                color: #a0aec0 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-blacklist-remove {
                background: #edf2f7 !important;
                color: #718096 !important;
            }

            html.utst-theme-light #utstTranslationBox #settingsPanel #bubbleBlacklistAdd {
                color: #ffffff !important;
            }

            html.utst-theme-light #utstTranslationBox #settingsPanel #bubbleBlacklistAdd:hover {
                color: #ffffff !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-shortcut-capture,
            html.utst-theme-light #utstTranslationBox .utst-shortcut-reset {
                background: #ffffff !important;
                border: 1px solid #cbd5e0 !important;
                color: #2d3748 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-shortcut-help {
                color: #718096 !important;
            }

            html.utst-theme-light #utstTranslationBox #settingsHeader {
                background: #ffffff !important;
                border-color: rgba(148, 163, 184, 0.45) !important;
            }

            html.utst-theme-light #utstTranslationBox #settingsPanel {
                background: transparent !important;
            }

            html.utst-theme-light #utstTranslationBox #panelThemeTrigger {
                background: #ffffff !important;
                border: 1px solid #94a3b8 !important;
                color: #2d3748 !important;
            }

            html.utst-theme-light #utstTranslationBox #panelThemePanel {
                background: #ffffff !important;
                border: 1px solid #cbd5e0 !important;
            }

            html.utst-theme-light #utstTranslationBox .utst-bubble-settings {
                border-top-color: rgba(74, 85, 104, 0.28) !important;
            }

            html.utst-theme-light #utstTranslationBox #speakTooltip {
                background: #ffffff !important;
                border: 1px solid #e2e8f0 !important;
                box-shadow: 0 4px 6px rgba(0,0,0,0.05) !important;
            }

            html.utst-theme-light #utstTranslationBox #speakTooltip .utst-speak-option:hover {
                background: rgba(45, 92, 190, 0.14) !important;
                color: #1f3f73 !important;
            }

            html.utst-theme-blue #utstTranslationBox #speakTooltip {
                background: rgba(20, 36, 64, 0.98) !important;
                border: 1px solid rgba(139, 177, 255, 0.34) !important;
                box-shadow: 0 10px 24px rgba(6, 15, 35, 0.48) !important;
            }

            html.utst-theme-blue #utstTranslationBox #speakTooltip .utst-speak-option:hover {
                background: rgba(120, 165, 255, 0.22) !important;
                color: #e9f1ff !important;
            }

            html.utst-theme-blue #panelThemePanel {
                background: linear-gradient(135deg, #1e1e2f 0%, #2a2a4a 100%) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45) !important;
                color: #ffffff !important;
            }

            html.utst-theme-light #fullscreenOverlay {
                background: rgba(0, 0, 0, 0.65) !important;
                backdrop-filter: blur(8px) !important;
            }

            html.utst-theme-light #fullscreenPanel {
                background: linear-gradient(135deg, #ffffff 0%, #f7f9fc 100%) !important;
                border-color: rgba(0, 0, 0, 0.08) !important;
                box-shadow: 0 20px 50px rgba(0,0,0,0.1) !important;
            }

            html.utst-theme-light #fullscreenPanel svg {
                stroke: #4a5568;
            }

            html.utst-theme-light #fullscreenPanel #fullscreenClose svg {
                stroke: #ef4444 !important;
            }

            html.utst-theme-light #fullscreenPanel #fullscreenSourceCopy,
            html.utst-theme-light #fullscreenPanel #fullscreenSourceSpeak,
            html.utst-theme-light #fullscreenPanel #fullscreenTargetCopy,
            html.utst-theme-light #fullscreenPanel #fullscreenTargetSpeak {
                background: #ffffff !important;
                border: 1px solid #cbd5e0 !important;
            }

            html.utst-theme-light #fullscreenPanel #fullscreenSourceCopy:hover,
            html.utst-theme-light #fullscreenPanel #fullscreenSourceSpeak:hover,
            html.utst-theme-light #fullscreenPanel #fullscreenTargetCopy:hover,
            html.utst-theme-light #fullscreenPanel #fullscreenTargetSpeak:hover {
                background: #f8fafc !important;
                border-color: #94a3b8 !important;
            }

            html.utst-theme-light #fullscreenPanel textarea,
            html.utst-theme-light #fullscreenPanel input,
            html.utst-theme-light #fullscreenPanel button[id$="LangTrigger"] {
                background: #ffffff !important;
                border: 1px solid #cbd5e0 !important;
                color: #2d3748 !important;
            }

            html.utst-theme-light #fullscreenPanel [id$="LangPanel"] {
                background: #ffffff !important;
                border: 1px solid #e2e8f0 !important;
                box-shadow: 0 10px 15px rgba(0,0,0,0.05) !important;
            }
            `;

        function getShadowSafeStyleText(cssText) {
            return cssText.replace(/html\.(utst-theme-[a-z]+)\s+/g, ':host(.$1) ');
        }

        function setImportantStyle(el, prop, value) {
            if (!el) return;
            el.style.setProperty(prop, value, 'important');
        }

        function createIsolatedUiRoot(cssText) {
            const host = document.createElement('div');
            host.id = 'utstShadowHost';
            setImportantStyle(host, 'all', 'initial');
            setImportantStyle(host, 'position', 'static');
            setImportantStyle(host, 'display', 'contents');
            // Prevent a flash of unstyled controls while the isolated UI is built.
            setImportantStyle(host, 'visibility', 'hidden');
            setImportantStyle(host, 'pointer-events', 'none');
            setImportantStyle(host, 'font-size', '14px');
            setImportantStyle(host, 'line-height', 'normal');
            setImportantStyle(host, 'color', '#fff');
            setImportantStyle(host, 'z-index', '2147483647');
            setImportantStyle(host, 'color-scheme', 'normal');
            setImportantStyle(host, 'forced-color-adjust', 'none');

            if (host.attachShadow) {
                const root = host.attachShadow({ mode: 'open' });
                const style = document.createElement('style');
                style.textContent = getShadowSafeStyleText(cssText);
                root.appendChild(style);
                document.documentElement.appendChild(host);
                return { host, root, usesShadow: true };
            }

            GM_addStyle(cssText);
            document.documentElement.appendChild(host);
            return { host, root: host, usesShadow: false };
        }

        const utstUi = createIsolatedUiRoot(UTST_STYLE_TEXT);
        const utstUiRoot = utstUi.root;

        // Состояние функций "перевод страницы" / "перевод области" — объявлено рано,
        // чтобы к моменту любых более поздних вызовов (в т.ч. из настроек) оно уже точно
        // существовало (иначе — та же ошибка порядка объявления, что уже однажды ловили).
        let pageTranslateActive = false;
        let pageTranslateInFlight = false;
        let pageTranslatedNodes = new Map(); // TextNode -> оригинальный текст
        let areaZoneState = { el: null, observer: null, translatedMap: new Map(), debounceTimer: null, active: false, targetLang: null, engine: null };
        let areaPickerActive = false;
        let areaPickerHoveredEl = null;
        let areaPickerCleanup = null;
        let areaPickerDoneCallback = null;

        function eventPathContains(event, element) {
            if (!event || !element) return false;
            const path = typeof event.composedPath === 'function' ? event.composedPath() : null;
            return (path && path.includes(element)) || (event.target && element.contains(event.target));
        }


        function getTranslationLibrary() {
            return (typeof window !== 'undefined' ? window.TraductionOutilTranslator : null)
                || (typeof globalThis !== 'undefined' ? globalThis.TraductionOutilTranslator : null);
        }

        function getSupportedUiLanguages(library, availableLanguageNames) {
            return Array.isArray(library.supportedUiLanguages) && library.supportedUiLanguages.length
                ? library.supportedUiLanguages
                : Object.keys(availableLanguageNames);
        }

        function normalizeInitialToolLanguage(preference, supportedLanguages) {
            return preference === 'browser' || supportedLanguages.includes(preference)
                ? preference
                : 'browser';
        }

        function getLocalizedValue(localizedValues, fallbackValues, key) {
            return localizedValues[key] || fallbackValues[key];
        }

        function getLanguageName(localizedLanguageNames, code, fallback) {
            return localizedLanguageNames[code] || fallback;
        }

        const translationLibrary = getTranslationLibrary();
        if (!translationLibrary || !translationLibrary.languageNames) {
            console.error('[TransDesk] Missing TraductionOutilTranslator language library.');
            return;
        }

        const browserLang = navigator.language.split('-')[0];
        const languageNames = translationLibrary.languageNames;
        const englishLangNames = getLanguageName(languageNames, 'en', {});
        const supportedUiLanguages = getSupportedUiLanguages(translationLibrary, languageNames);

        const storedToolLangPref = GM_getValue('defaultToolLang', 'browser');
        const normalizedToolLangPref = normalizeInitialToolLanguage(storedToolLangPref, supportedUiLanguages);
        if (normalizedToolLangPref !== storedToolLangPref) {
            GM_setValue('defaultToolLang', normalizedToolLangPref);
        }

        function resolveUiLang(preference) {
            if (preference === 'browser') {
                return languageNames[browserLang] ? browserLang : 'en';
            }
            return languageNames[preference] ? preference : (languageNames[browserLang] ? browserLang : 'en');
        }

        let toolLanguagePreference = normalizedToolLangPref;
        const uiLang = resolveUiLang(toolLanguagePreference);
        let langNames = languageNames[uiLang];
        let errors = langNames.errors;
        let tooltips = langNames.tooltips;
        let dragHandleLabel = getLocalizedValue(langNames, languageNames.en, 'dragHandleLabel');
        let overlayLabels = getLocalizedValue(langNames, languageNames.en, 'overlay');
        let settingsTitle = getLocalizedValue(langNames, languageNames.en, 'settingsTitle');
        let settingsDefaultLabel = getLocalizedValue(langNames, languageNames.en, 'settingsDefaultLabel');
        let settingsToolLabel = getLocalizedValue(langNames, languageNames.en, 'settingsToolLabel');

        const languages = [
            { code: 'auto', name: getLanguageName(englishLangNames, 'auto', langNames.auto) },
            { code: 'en', name: getLanguageName(englishLangNames, 'en', 'English') },
            { code: 'fr', name: getLanguageName(englishLangNames, 'fr', 'French') },
            { code: 'es', name: getLanguageName(englishLangNames, 'es', 'Spanish') },
            { code: 'de', name: getLanguageName(englishLangNames, 'de', 'German') },
            { code: 'it', name: getLanguageName(englishLangNames, 'it', 'Italian') },
            { code: 'pt', name: getLanguageName(englishLangNames, 'pt', 'Portuguese') },
            { code: 'ru', name: getLanguageName(englishLangNames, 'ru', 'Russian') },
            { code: 'zh-CN', name: getLanguageName(englishLangNames, 'zh-CN', 'Chinese (Simplified)') },
            { code: 'ja', name: getLanguageName(englishLangNames, 'ja', 'Japanese') },
            { code: 'navigator', name: getLanguageName(englishLangNames, 'navigator', 'Browser language') }
        ];

        const googleTranslateLanguages = {
            'af': 'Afrikaans',
            'sq': 'Albanian',
            'am': 'Amharic',
            'ar': 'Arabic',
            'hy': 'Armenian',
            'az': 'Azerbaijani',
            'eu': 'Basque',
            'be': 'Belarusian',
            'bn': 'Bengali',
            'bs': 'Bosnian',
            'bg': 'Bulgarian',
            'ca': 'Catalan',
            'ceb': 'Cebuano',
            'ny': 'Chichewa',
            'zh-CN': 'Chinese (Simplified)',
            'zh-TW': 'Chinese (Traditional)',
            'co': 'Corsican',
            'hr': 'Croatian',
            'cs': 'Czech',
            'da': 'Danish',
            'nl': 'Dutch',
            'en': 'English',
            'eo': 'Esperanto',
            'et': 'Estonian',
            'tl': 'Filipino',
            'fi': 'Finnish',
            'fr': 'French',
            'gl': 'Galician',
            'ka': 'Georgian',
            'de': 'German',
            'el': 'Greek',
            'gu': 'Gujarati',
            'ht': 'Haitian Creole',
            'ha': 'Hausa',
            'haw': 'Hawaiian',
            'he': 'Hebrew',
            'hi': 'Hindi',
            'hmn': 'Hmong',
            'hu': 'Hungarian',
            'is': 'Icelandic',
            'ig': 'Igbo',
            'id': 'Indonesian',
            'ga': 'Irish',
            'it': 'Italian',
            'ja': 'Japanese',
            'jw': 'Javanese',
            'kn': 'Kannada',
            'kk': 'Kazakh',
            'km': 'Khmer',
            'rw': 'Kinyarwanda',
            'ko': 'Korean',
            'ku': 'Kurdish',
            'ky': 'Kyrgyz',
            'lo': 'Lao',
            'la': 'Latin',
            'lv': 'Latvian',
            'lt': 'Lithuanian',
            'lb': 'Luxembourgish',
            'mk': 'Macedonian',
            'mg': 'Malagasy',
            'ms': 'Malay',
            'ml': 'Malayalam',
            'mt': 'Maltese',
            'mi': 'Maori',
            'mr': 'Marathi',
            'mn': 'Mongolian',
            'my': 'Myanmar',
            'ne': 'Nepali',
            'no': 'Norwegian',
            'or': 'Odia',
            'ps': 'Pashto',
            'fa': 'Persian',
            'pl': 'Polish',
            'pt': 'Portuguese',
            'pa': 'Punjabi',
            'ro': 'Romanian',
            'ru': 'Russian',
            'sm': 'Samoan',
            'gd': 'Scots Gaelic',
            'sr': 'Serbian',
            'st': 'Sesotho',
            'sn': 'Shona',
            'sd': 'Sindhi',
            'si': 'Sinhala',
            'sk': 'Slovak',
            'sl': 'Slovenian',
            'so': 'Somali',
            'es': 'Spanish',
            'su': 'Sundanese',
            'sw': 'Swahili',
            'sv': 'Swedish',
            'tg': 'Tajik',
            'ta': 'Tamil',
            'tt': 'Tatar',
            'te': 'Telugu',
            'th': 'Thai',
            'tr': 'Turkish',
            'tk': 'Turkmen',
            'uk': 'Ukrainian',
            'ur': 'Urdu',
            'ug': 'Uyghur',
            'uz': 'Uzbek',
            'vi': 'Vietnamese',
            'cy': 'Welsh',
            'xh': 'Xhosa',
            'yi': 'Yiddish',
            'yo': 'Yoruba',
            'zu': 'Zulu'
        };


        const defaultTargetLang = languages.some(lang => lang.code === browserLang && lang.code !== 'auto') ? browserLang : 'en';

        const commonFavoriteTargetLangs = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'zh-CN', 'ja'];

        function buildFavoriteTargetLanguages() {
            const favorites = ['navigator'];
            if (googleTranslateLanguages[browserLang] && !favorites.includes(browserLang)) {
                favorites.push(browserLang);
            }
            commonFavoriteTargetLangs.forEach(code => {
                if (!favorites.includes(code)) {
                    favorites.push(code);
                }
            });
            return favorites;
        }

        const favoriteTargetLangs = buildFavoriteTargetLanguages();
        const sortedGoogleLanguageEntries = Object.entries(googleTranslateLanguages)
            .sort(([, nameA], [, nameB]) => nameA.localeCompare(nameB));

        function getLanguageLabel(code) {
            if (code === 'auto') {
                return langNames.auto || englishLangNames.auto || 'Detect language';
            }
            if (code === 'navigator') {
                return englishLangNames.navigator || 'Browser language';
            }
            return englishLangNames[code] || googleTranslateLanguages[code] || code;
        }

        function buildTargetLanguageOptions(includeNavigator = false) {
            const favorites = favoriteTargetLangs
                .filter(code => code === 'navigator' ? includeNavigator : googleTranslateLanguages[code])
                .map(code => {
                    const optionValue = code === 'navigator' ? 'navigator' : code;
                    return `<option value="${optionValue}">${getLanguageLabel(optionValue)}</option>`;
                })
                .join('');

            const favoriteCodes = new Set(favoriteTargetLangs.filter(code => code !== 'navigator'));
            const others = sortedGoogleLanguageEntries
                .filter(([code]) => !favoriteCodes.has(code))
                .map(([code, name]) => `<option value="${code}">${name}</option>`)
                .join('');

            const parts = [];
            if (favorites) {
                parts.push(favorites);
            }
            if (others) {
                if (favorites) {
                    parts.push('<option value="" disabled>--------------------</option>');
                }
                parts.push(others);
            }
            return parts.join('');
        }

        function getToolLanguageLabel(code) {
            if (code === 'browser') {
                return englishLangNames.navigator || 'Browser language';
            }
            return englishLangNames[code] || languageNames.en[code] || code;
        }

        function buildToolLanguageOptionsHtml() {
            return ['browser', ...supportedUiLanguages]
                .map(code => `<option value="${code}">${getToolLanguageLabel(code)}</option>`)
                .join('');
        }

        function buildSourceLanguageOptionsHtml() {
            const entries = Object.entries(googleTranslateLanguages)
                .sort(([, a], [, b]) => a.localeCompare(b));
            const options = entries
                .map(([code, name]) => `<option value="${code}">${name}</option>`)
                .join('');
            return `<option value="auto">${langNames.auto}</option>${options}`;
        }

        const toolLanguageOptionsHtml = buildToolLanguageOptionsHtml();
        let sourceLanguageOptionsHtml = buildSourceLanguageOptionsHtml();

        const targetLanguageOptionsHtml = buildTargetLanguageOptions(true);

        const translationBox = document.createElement('div');
        translationBox.id = 'utstTranslationBox';
        translationBox.style.cssText = `
            all: initial;
            position: absolute;
            background: linear-gradient(135deg, #1e1e2f 0%, #2a2a4a 100%);
            color: #ffffff;
            padding: 20px;
            padding-top: 40px;
            border-radius: 12px;
            z-index: 9999;
            display: none;
            min-width: 370px;
            max-width: 420px;
            min-height: 200px;
            max-height: 360px;
            overflow-y: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
            transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.3s ease;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            box-sizing: border-box;
            line-height: 1.35;
            direction: ltr;
            text-align: left;
        `;
                utstUiRoot.appendChild(translationBox);


                translationBox.innerHTML = `
            <div id="dragHandle" title="${dragHandleLabel}" style="position:absolute; top:0; left:0; right:0; height:28px; background: linear-gradient(120deg, #3a3a3f, #4b4b52); border-radius: 12px 12px 0 0; cursor: move; display:flex; align-items:center; gap:8px; padding:0 34px 0 12px; color:#e5e5e5; font-size:12px; font-weight:600; letter-spacing:0.3px; box-shadow: inset 0 -1px 0 rgba(255,255,255,0.08); user-select: none;">
                <img class="utst-header-logo" data-utst-logo-src="${UTST_LOGO_URL}" alt="" draggable="false" aria-hidden="true">
                <span style="opacity:0.95; font-weight:700; letter-spacing:0.3px;">TransDesk</span>
                <div style="width:32px; height:4px; border-radius:4px; background:rgba(255,255,255,0.4); margin-left:auto; flex-shrink:0;"></div>
            </div>
            <div style="
            position: absolute;
            top: 6px;
            right: 8px;
            background: none;
            border: none;
            color: #ff4d4d;
            font-size: 18px;
            font-weight: bold;
            cursor: pointer;
            line-height: 1;">
                <div id="closeButton" style="cursor: pointer;" title="Fermer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4d" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </div>
            </div>
            <div id="settingsHeader" style="position: absolute; top: 34px; left: 8px; display:none; align-items: center; gap: 8px; cursor: default;">
                <div id="backButton" style="width:20px; height:20px; min-width:20px; display:flex; align-items:center; justify-content:center; line-height:0; flex:0 0 20px; cursor:pointer;" title="Back">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                    stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
                </div>
                <span id="settingsHeaderTitle" style="color:#fff; font-size:14px; font-weight:600; letter-spacing:0.3px;">${settingsTitle}</span>
            </div>

        <div id="translatorPanel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;user-select: none;">
                <select id="sourceLang" style="background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 6px; font-size: 13px; cursor: pointer;">
                    <option value="auto">Detect language</option>
            ${Object.entries(googleTranslateLanguages).map(([code, name]) =>
                    `<option value="${code}">${name}</option>`).join('')}
        </select>
                <span style="color: #a0a0c0; margin: 0 8px;">→</span>
                <select id="targetLang"
                    style="background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 6px; font-size: 13px; cursor: pointer;">
                    ${targetLanguageOptionsHtml}
        </select>

            </div>
        <div id="translationTextWrap" style="position:relative;">
            <div id="translationText"
                style="background: rgba(255, 255, 255, 0.05); padding: 12px; border-radius: 8px; min-height: 110px; height: 110px; max-height: 110px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; overflow-y: auto;">
            </div>
            <div id="utstPanelLoading" class="utst-modern-loader" data-mode="translate" aria-hidden="true" style="border-radius:8px;">
                <div class="utst-modern-loader__card">
                    <div class="utst-modern-loader__ring"></div>
                    <div class="utst-modern-loader__body">
                        <div id="utstPanelLoadingTitle" class="utst-modern-loader__title">${overlayLabels.translate}...</div>
                        <div class="utst-modern-loader__line"></div>
                    </div>
                </div>
            </div>
        </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 12px; gap: 10px; margin-bottom: 12px;">
                <div id="speakButton" style="position: relative; cursor: pointer;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                    <div id="speakTooltip"
                        style="display: none; position: absolute; bottom: 100%; right: 0; background: rgba(0, 0, 0, 0.8); color: #fff; padding: 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; z-index: 10000;">
                        <div id="speakTranslated" class="utst-speak-option" style="padding: 6px 10px; cursor: pointer; border-radius:3px; transition: background 0.15s ease, color 0.15s ease;">${tooltips.listenTranslated}</div>
                        <div id="speakOriginal" class="utst-speak-option" style="padding: 6px 10px; cursor: pointer; border-radius:3px; transition: background 0.15s ease, color 0.15s ease;">${tooltips.listenOriginal}</div>
                    </div>
                </div>
                <div id="copyButton" style="cursor: pointer;" title="Copy translation">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </div>
                <div id="fullscreenToggle" style="cursor: pointer;" title="${overlayLabels.open}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <polyline points="9 21 3 21 3 15"></polyline>
                        <line x1="21" y1="3" x2="14" y2="10"></line>
                        <line x1="3" y1="21" x2="10" y2="14"></line>
                    </svg>
                </div>
                <div id="settingsButton" style="cursor: pointer;" title="Settings">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M12 15.5C13.933 15.5 15.5 13.933 15.5 12C15.5 10.067 13.933 8.5 12 8.5C10.067 8.5 8.5 10.067 8.5 12C8.5 13.933 10.067 15.5 12 15.5Z"
                            stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                        <path
                            d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z"
                            stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                    </svg>

                </div>

            </div>

            <div id="replySuggestionWrap" style="display:none; margin-top:4px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <span style="color:#a0a0c0; font-size:12px; font-weight:600;">Подсказка ответа</span>
                        <span id="replySuggestionBadge" style="display:none; font-size:10px; font-weight:700; letter-spacing:0.3px; padding:2px 7px; border-radius:20px; background:rgba(120,170,255,0.18); border:1px solid rgba(120,170,255,0.35); color:#bcd0ff;"></span>
                    </div>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div id="replySuggestionRefresh" style="cursor:pointer;" title="Сгенерировать заново">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                        </div>
                        <div id="replySuggestionCopy" style="cursor:pointer;" title="Скопировать подсказку">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </div>
                    </div>
                </div>
                <div id="replySuggestionText" style="background: rgba(120,170,255,0.08); border:1px solid rgba(120,170,255,0.25); padding: 10px; border-radius: 8px; min-height: 46px; max-height: 130px; overflow-y:auto; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; color:#e5e5ff;"></div>
            </div>
        </div>


        <div id="settingsPanel" style="display:none; padding:31px 20px 20px; min-height:176px; max-height:520px; min-width:370px; max-width:370px; overflow-y:auto; box-sizing:border-box;">

        <label for="defaultSourceLang" style="color:#fff; font-size:14px; display:block; margin-bottom:4px;">
        Язык, с которого переводить
        </label>
        <select id="defaultSourceLang" style="display:block; width:100%; max-width:260px; margin:0 auto; padding:5px 6px; border-radius:6px; background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); font-size:13px; cursor: pointer;">
        ${sourceLanguageOptionsHtml}
        </select>
        <div style="font-size: 11px; color: rgba(255,255,255,0.45); max-width:260px; margin:4px auto 12px; text-align:center;">По умолчанию — "Автоопределение". Если скрипт иногда путает язык (короткие фразы, похожие алфавиты), задайте здесь конкретный язык, с которого почти всегда переводите — скрипт перестанет угадывать и будет считать, что текст всегда на нём.</div>

        <label for="defaultTranslateLang" style="color:#fff; font-size:14px; display:block; margin-bottom:4px;">
        ${settingsDefaultLabel}
        </label>
        <select id="defaultTranslateLang" style="display:block; width:100%; max-width:260px; margin:0 auto; padding:5px 6px; border-radius:6px; background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); font-size:13px; cursor: pointer;">
        ${targetLanguageOptionsHtml}
        </select>

        <label for="toolLanguage" style="color:#fff; font-size:14px; display:block; margin:12px 0 4px;">
        ${settingsToolLabel}
        </label>
        <select id="toolLanguage" style="display:block; width:100%; max-width:260px; margin:0 auto; padding:5px 6px; border-radius:6px; background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); font-size:13px; cursor: pointer;">
        ${toolLanguageOptionsHtml}
        </select>

        <label for="panelTheme" style="color:#fff; font-size:14px; display:block; margin:12px 0 4px;">
        ${langNames.settingsThemeLabel}
        </label>
        <div id="panelThemePicker" style="position:relative; width:100%; max-width:260px; margin:0 auto;">
        <button id="panelThemeTrigger" type="button" style="display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; padding:6px 10px; border-radius:8px; background: rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.14); color:#fff; cursor:pointer; font-size:12px;">
            <span id="panelThemeCurrent">${langNames.themes.blue}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div id="panelThemePanel" style="display:none; position:absolute; top:calc(100% + 6px); right:0; left:0; width:100%; max-height:220px; border-radius:10px; padding:8px; z-index:2147483646;">
            <div id="panelThemeGrid" style="display:grid; grid-template-columns:1fr; gap:6px;"></div>
        </div>
        </div>
        <select id="panelTheme" style="display:none;">
        <option value="blue">${langNames.themes.blue}</option>
        <option value="dark">${langNames.themes.dark}</option>
        <option value="light">${langNames.themes.light}</option>
        </select>

        <label id="shortcutCaptureLabel" for="shortcutCaptureButton" style="color:#fff; font-size:14px; display:block; margin:12px 0 4px;">
        ${getLocalizedValue(langNames, languageNames.en, 'settingsShortcutLabel')}
        </label>
        <div class="utst-shortcut-control">
            <button id="shortcutCaptureButton" class="utst-shortcut-capture" type="button"></button>
            <button id="shortcutResetButton" class="utst-shortcut-reset" type="button" title="${getLocalizedValue(langNames, languageNames.en, 'settingsShortcutReset')}">↺</button>
        </div>
        <div id="shortcutCaptureHelp" class="utst-shortcut-help"></div>

        <div class="utst-bubble-settings">
        <label class="utst-toggle-row" for="selectionBubbleEnabled">
            <input id="selectionBubbleEnabled" type="checkbox" />
            <span>${langNames.settingsBubbleLabel}</span>
        </label>

        <label for="bubbleBlacklistInput" style="color:#fff; font-size:13px; display:block; margin-bottom:4px;">
            ${langNames.settingsBlacklistLabel}
        </label>
        <div class="utst-blacklist-controls">
            <input id="bubbleBlacklistInput" class="utst-blacklist-input" type="text" placeholder="example.com" />
            <button id="bubbleBlacklistAdd" class="utst-blacklist-add" type="button">${langNames.settingsBlacklistAdd}</button>
        </div>
        <div id="bubbleBlacklistList" class="utst-blacklist-list utst-scroll"></div>
        </div>
        <div class="utst-bubble-settings" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.1); display:flex; flex-direction:column; gap:10px;">
            <div style="font-size: 14px; color:#fff; font-weight:600;">Чем переводить</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Можно развести нагрузку: например, сообщения лида переводить через ИИ (качественнее), а поля ввода — через Google (почти мгновенно, без "раздумий" модели).</div>

            <label for="panelTranslateEngine" style="color:#fff; font-size:12px;">Перевод сообщений лида (панель, Ctrl+L):</label>
            <select id="panelTranslateEngine" class="utst-blacklist-input" style="cursor:pointer;">
                <option value="google">Google Translate — быстро</option>
                <option value="ai">ИИ — качественнее, но медленнее</option>
            </select>

            <label for="fieldTranslateEngine" style="color:#fff; font-size:12px;">Перевод полей ввода (CRM, чаты):</label>
            <select id="fieldTranslateEngine" class="utst-blacklist-input" style="cursor:pointer;">
                <option value="google">Google Translate — быстро</option>
                <option value="ai">ИИ — качественнее, но медленнее</option>
            </select>

            <div id="aiSettingsBlock" style="display: none; flex-direction: column; gap: 10px; margin-top: 4px;">
                <label for="aiProviderSelect" style="color:#fff; font-size:12px;">Провайдер ИИ:</label>
                <select id="aiProviderSelect" class="utst-blacklist-input" style="cursor:pointer;">
                    <option value="openrouter">OpenRouter (много бесплатных моделей)</option>
                    <option value="nvidia">NVIDIA (build.nvidia.com / NIM)</option>
                </select>

                <div id="openRouterSettingsBlock" style="display:flex; flex-direction:column; gap:10px;">
                <label for="openRouterApiKey" style="color:#fff; font-size:12px;">API ключ OpenRouter:</label>
                <input id="openRouterApiKey" class="utst-blacklist-input" type="password" placeholder="sk-or-..." />
                <label for="aiModelSelect" style="color:#fff; font-size:12px;">Модель ИИ (бесплатные, OpenRouter):</label>
                <select id="aiModelSelect" class="utst-blacklist-input" style="cursor: pointer;">
                    <option value="google/gemma-4-31b-it:free">Google Gemma 4 31B — лучшее качество (Free, 262K)</option>
                    <option value="nvidia/nemotron-3-super-120b-a12b:free">NVIDIA Nemotron 3 Super 120B (Free, 262K)</option>
                    <option value="google/gemma-4-26b-a4b-it:free">Google Gemma 4 26B (Free, 262K)</option>
                    <option value="openai/gpt-oss-20b:free">OpenAI GPT-OSS 20B (Free, 131K)</option>
                    <option value="nvidia/nemotron-3-nano-30b-a3b:free">NVIDIA Nemotron 3 Nano 30B — быстрая (Free, 256K)</option>
                    <option value="nvidia/nemotron-nano-9b-v2:free">NVIDIA Nemotron Nano 9B — самая быстрая (Free, 128K)</option>
                    <option value="nvidia/nemotron-3-ultra-550b-a55b:free">NVIDIA Nemotron 3 Ultra 550B — макс. контекст (Free, 1M)</option>
                    <option value="inclusionai/ling-3.0-flash:free">InclusionAI Ling 3.0 Flash (Free, 262K)</option>
                    <option value="poolside/laguna-s-2.1:free">Poolside Laguna S 2.1 (Free, 262K)</option>
                    <option value="cohere/north-mini-code:free">Cohere North Mini Code (Free, 256K)</option>
                    <option value="openrouter/free">OpenRouter Auto-Router (Free, 200K)</option>
                </select>
                <div style="font-size: 11px; color: rgba(255,255,255,0.45);">Список подтягивается автоматически с OpenRouter (раз в сутки) — вручную обновлять не нужно, но можно кнопкой ниже.</div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button id="aiModelListRefresh" type="button" class="utst-shortcut-reset" style="width:auto; flex-shrink:0; font-size:11px; padding:4px 10px;" title="Обновить список моделей">↺ Обновить</button>
                    <div id="aiModelListStatus" style="font-size:11px; color: rgba(255,255,255,0.45);"></div>
                </div>
                <label style="display:flex; align-items:center; gap:8px; color:#fff; font-size:12px; cursor:pointer; margin-top:2px;">
                    <input type="checkbox" id="aiModelFallbackToggle" style="cursor:pointer;">
                    Если модель недоступна — автоматически пробовать следующую бесплатную
                </label>
                </div>

                <div id="nvidiaSettingsBlock" style="display:none; flex-direction:column; gap:10px;">
                <label for="nvidiaApiKey" style="color:#fff; font-size:12px;">API ключ NVIDIA (build.nvidia.com):</label>
                <input id="nvidiaApiKey" class="utst-blacklist-input" type="password" placeholder="nvapi-..." />
                <div style="font-size: 11px; color: rgba(255,255,255,0.45);">Ключ берётся на build.nvidia.com → любая модель → "Get API Key". У NVIDIA свой отдельный бесплатный лимит запросов, не связанный с OpenRouter.</div>
                <label for="nvidiaModelSelect" style="color:#fff; font-size:12px;">Модель NVIDIA:</label>
                <select id="nvidiaModelSelect" class="utst-blacklist-input" style="cursor: pointer;"></select>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button id="nvidiaModelListRefresh" type="button" class="utst-shortcut-reset" style="width:auto; flex-shrink:0; font-size:11px; padding:4px 10px;" title="Обновить список моделей своим ключом">↺ Обновить по ключу</button>
                    <div id="nvidiaModelListStatus" style="font-size:11px; color: rgba(255,255,255,0.45);"></div>
                </div>
                <label for="nvidiaCustomModel" style="color:#fff; font-size:12px;">Или укажите ID модели вручную:</label>
                <input id="nvidiaCustomModel" class="utst-blacklist-input" type="text" placeholder="например, meta/llama-3.3-70b-instruct" />
                <div style="font-size: 11px; color: rgba(255,255,255,0.45);">Если это поле не пустое — используется оно, а не выбор выше. Полный каталог моделей — на build.nvidia.com.</div>
                </div>

                <div style="max-width:260px; margin:2px auto 0;">
                    <button id="pingModelsButton" type="button" class="utst-shortcut-capture" style="width:100%;">Проверить скорость моделей</button>
                </div>
                <div id="pingModelsResults" style="display:none; flex-direction:column; gap:4px; font-size:11px; max-height:200px; overflow-y:auto; margin-top:2px; padding-right:2px;"></div>
                <label for="aiSystemPrompt" style="color:#fff; font-size:12px;">Системный промпт:</label>
                <textarea id="aiSystemPrompt" class="utst-blacklist-input" style="min-height: 80px; resize: vertical; font-family: monospace;" placeholder="You are a professional translator..."></textarea>
                <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Используйте {target_lang} для автоматической подстановки языка перевода.</div>
            </div>
        </div>
        <div class="utst-bubble-settings" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.1); display:flex; flex-direction:column; gap:10px;">
            <label id="fieldShortcutCaptureLabel" for="fieldShortcutCaptureButton" style="color:#fff; font-size:14px; display:block; margin-bottom:4px;">Перевод текста в полях ввода (CRM, чаты)</label>
            <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 10px;">Хоткей переводит текст прямо в поле ввода (input/textarea) — работает независимо от основного хоткея выделения, чтобы не конфликтовать с отправкой сообщения на сайте.</div>
            <div class="utst-shortcut-control">
                <button id="fieldShortcutCaptureButton" class="utst-shortcut-capture" type="button"></button>
                <button id="fieldShortcutResetButton" class="utst-shortcut-reset" type="button" title="Сбросить сочетание">↺</button>
            </div>
            <div id="fieldShortcutCaptureHelp" class="utst-shortcut-help"></div>
            <label for="fieldTargetLangSelect" style="color:#fff; font-size:12px; display:block; margin:10px 0 4px;">Язык перевода для полей ввода:</label>
            <select id="fieldTargetLangSelect" class="utst-blacklist-input" style="cursor: pointer;">
                ${targetLanguageOptionsHtml}
            </select>
        </div>
        <div class="utst-bubble-settings" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.1); display:flex; flex-direction:column; gap:10px;">
            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-size:14px; cursor:pointer; margin-bottom:2px;">
                <input type="checkbox" id="pageTranslateAutoToggle" style="cursor:pointer;">
                Переводить всю страницу автоматически при открытии
            </label>
            <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Работает на всех сайтах, кроме тех, что в чёрном списке (раздел выше). Хоткей ниже переводит/возвращает оригинал в любой момент вручную — независимо от этой галочки.</div>
            <div class="utst-shortcut-control">
                <button id="pageShortcutCaptureButton" class="utst-shortcut-capture" type="button"></button>
                <button id="pageShortcutResetButton" class="utst-shortcut-reset" type="button" title="Сбросить сочетание">↺</button>
            </div>
            <div id="pageShortcutCaptureHelp" class="utst-shortcut-help"></div>
            <label for="pageTranslateLang" style="color:#fff; font-size:12px; display:block; margin-top:4px;">Язык перевода страницы:</label>
            <select id="pageTranslateLang" class="utst-blacklist-input" style="cursor: pointer;">
                ${targetLanguageOptionsHtml}
            </select>
            <label for="pageTranslateEngine" style="color:#fff; font-size:12px;">Чем переводить:</label>
            <select id="pageTranslateEngine" class="utst-blacklist-input" style="cursor:pointer;">
                <option value="google">Google Translate — быстро, рекомендуется</option>
                <option value="ai">ИИ — медленно на больших страницах</option>
            </select>
            <div style="font-size: 11px; color: rgba(255,255,255,0.45);">На странице обычно сотни текстовых фрагментов — через ИИ перевод займёт заметно больше времени и токенов, чем через Google. Google — разумный выбор по умолчанию.</div>
        </div>
        <div class="utst-bubble-settings" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.1); display:flex; flex-direction:column; gap:10px;">
            <div style="font-size: 14px; color:#fff; font-weight:600;">Перевод определённой области</div>
            <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Один раз укажите область на сайте (например, панель с сообщениями лида) — скрипт будет переводить в ней всё, включая новые сообщения, которые появляются позже, без повторных действий с вашей стороны. Настройка привязана к текущему домену.</div>
            <div style="max-width:260px; margin:0 auto;">
                <button id="areaPickButton" type="button" class="utst-shortcut-capture" style="width:100%;">🎯 Выбрать область на странице</button>
            </div>
            <div id="areaZoneStatus" style="font-size:11px; color: rgba(255,255,255,0.5); text-align:center;"></div>
            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-size:12px; cursor:pointer;">
                <input type="checkbox" id="areaZoneEnabledToggle" style="cursor:pointer;">
                Перевод области включён
            </label>
            <div style="max-width:260px; margin:0 auto;">
                <button id="areaZoneClearButton" type="button" class="utst-shortcut-reset" style="width:auto; padding:4px 10px; font-size:11px;">Забыть область на этом сайте</button>
            </div>
            <label for="areaTranslateLang" style="color:#fff; font-size:12px;">Язык перевода области:</label>
            <select id="areaTranslateLang" class="utst-blacklist-input" style="cursor:pointer;">
                ${targetLanguageOptionsHtml}
            </select>
            <label for="areaTranslateEngine" style="color:#fff; font-size:12px;">Чем переводить:</label>
            <select id="areaTranslateEngine" class="utst-blacklist-input" style="cursor:pointer;">
                <option value="google">Google Translate — быстро</option>
                <option value="ai">ИИ</option>
            </select>
        </div>
        <div class="utst-bubble-settings" style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.1); display:flex; flex-direction:column; gap:10px;">
            <label style="display:flex; align-items:center; gap:8px; color:#fff; font-size:14px; cursor:pointer; margin-bottom:6px;">
                <input type="checkbox" id="replySuggestionToggle" style="cursor:pointer;">
                Подсказка ответа лиду под переводом
            </label>
            <div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 10px;">При переводе выделенного сообщения дополнительно предлагается готовый вариант ответа — остаётся скопировать.</div>

            <label for="replySuggestionSource" style="color:#fff; font-size:12px;">Источник подсказки:</label>
            <select id="replySuggestionSource" class="utst-blacklist-input" style="cursor:pointer; margin-bottom:8px;">
                <option value="ai">Только ИИ</option>
                <option value="pool">Только база (GitHub)</option>
                <option value="pool_ai">База + ИИ (адаптирует шаблон под текст)</option>
            </select>

            <label for="replySuggestionPoolUrl" style="color:#fff; font-size:12px;">Raw-URL базы подсказок (JSON):</label>
            <input type="text" id="replySuggestionPoolUrl" class="utst-blacklist-input" placeholder="https://raw.githubusercontent.com/user/repo/main/replies.json" style="width:100%; box-sizing:border-box;">
            <div style="font-size: 11px; color: rgba(255,255,255,0.45); margin: 4px 0 8px;">Формат файла — JSON-массив, на одну тему можно указать сколько угодно вариантов ответа: <span style="font-family:monospace;">[{"keywords":["как дела","how are you"],"replies":["Вариант 1...","Вариант 2...","Вариант 3..."]}]</span>. Тема выбирается по наибольшему числу совпавших ключевых слов в исходном сообщении. Старый формат с одиночным полем <span style="font-family:monospace;">"reply"</span> тоже понимается.</div>
            <div style="max-width:260px; margin:0 auto 6px;">
                <button id="replySuggestionPoolRefresh" type="button" class="utst-shortcut-capture" style="width:100%;">Обновить базу из GitHub</button>
            </div>
            <div id="replySuggestionPoolStatus" style="font-size:11px; color: rgba(255,255,255,0.5); text-align:center; margin-bottom:8px; min-height:14px;"></div>

            <label for="replySuggestionVariantMode" style="color:#fff; font-size:12px;">Если для темы найдено несколько вариантов:</label>
            <select id="replySuggestionVariantMode" class="utst-blacklist-input" style="cursor:pointer; margin-bottom:2px;">
                <option value="random">Взять случайный</option>
                <option value="ai_pick">ИИ выбирает наиболее подходящий и дорабатывает (только режим «База + ИИ»)</option>
            </select>
            <div style="font-size: 11px; color: rgba(255,255,255,0.45); margin-bottom: 8px;">В режиме «Только база» ИИ не задействуется — выбор всегда случайный, без запроса.</div>

            <label for="replySuggestionLangSelect" style="color:#fff; font-size:12px;">Язык подсказки:</label>
            <select id="replySuggestionLangSelect" class="utst-blacklist-input" style="cursor:pointer; margin-bottom:8px;">
                ${targetLanguageOptionsHtml}
            </select>

            <label for="replySuggestionPrompt" style="color:#fff; font-size:12px;">Промпт для ИИ-подсказки:</label>
            <textarea id="replySuggestionPrompt" class="utst-blacklist-input" style="min-height: 70px; resize: vertical; font-family: monospace;" placeholder="You are a support agent replying to a lead..."></textarea>
            <div style="font-size: 11px; color: rgba(255,255,255,0.5);">Доступны {source_text} (сообщение лида — подставляется автоматически как запрос), {target_lang} (язык подсказки), {template} (найденный шаблон из базы, если есть).</div>
        </div>
        </div>



    `;
        translationBox.classList.add("utst-scroll");

        const fullscreenOverlay = document.createElement('div');
        fullscreenOverlay.id = 'fullscreenOverlay';
        fullscreenOverlay.style.cssText = `
        all: initial;
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(8px);
        z-index: 10001;
        padding: 18px;
        box-sizing: border-box;
    `;
        fullscreenOverlay.innerHTML = `
      <div id="fullscreenPanel" style="width: min(1100px, 95vw); min-height: 40vh; background: linear-gradient(135deg, #1e1e2f 0%, #2a2a4a 100%); color: #fff; border-radius: 14px; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 12px 32px rgba(0,0,0,0.45); padding: 22px 22px 16px; position: relative;">
        <div style="display:flex; align-items:center; justify-content: space-between; margin-bottom: 14px;">
            <div id="fullscreenTitleWrap" title="${overlayLabels.title}">
                <img class="utst-header-logo" data-utst-logo-src="${UTST_LOGO_URL}" alt="" draggable="false" aria-hidden="true">
                <div id="fullscreenTitle" style="font-size:16px; font-weight:700; letter-spacing:0.4px; color:#e7e9ff; cursor: default;">TransDesk</div>
            </div>
            <div id="fullscreenClose" style="cursor:pointer; width:26px; height:26px; display:flex; align-items:center; justify-content:center; border-radius:8px; transition: background 0.15s ease;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
        </div>
        <div id="fullscreenColumns" style="display:flex; gap: 16px; min-height: 280px; flex-wrap: wrap;">
            <div style="flex:1; min-width:280px; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <label id="fullscreenSourceLabel" style="color:#cfd3ff; font-size:13px; font-weight:600; letter-spacing:0.2px;">${overlayLabels.source}</label>
                    <div id="fullscreenSourcePicker" style="position:relative;">
                        <button id="fullscreenSourceLangTrigger" style="display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; background: rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.14); color:#fff; cursor:pointer; font-size:12px;">
                            <span id="fullscreenSourceLangCurrent">${langNames.auto}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        <div id="fullscreenSourceLangPanel" style="display:none; position:absolute; top:110%; right:0; width:280px; max-height:260px; background: rgba(30,30,47,0.98); border:1px solid rgba(255,255,255,0.12); box-shadow:0 10px 24px rgba(0,0,0,0.35); border-radius:10px; padding:8px; z-index:10002;">
                            <input id="fullscreenSourceLangSearch" placeholder="${langNames.navigator}" style="width:100%; max-width:100%; box-sizing:border-box; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); color:#fff; font-size:13px; outline:none;" />
                            <div id="fullscreenSourceLangGrid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:6px; max-height:190px; overflow-y:auto; padding-top:8px;"></div>
                        </div>
                    </div>
                </div>
                <select id="fullscreenSourceLang" style="display:none;">${sourceLanguageOptionsHtml}</select>
                <div id="fullscreenSourceWrap" style="position:relative; flex:1; min-height:200px;">
                    <textarea id="fullscreenSource" spellcheck="false" autocorrect="off" autocapitalize="off" style="width:100%; height:100%; min-height:200px; padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#fff; font-size:14px; line-height:1.5; resize: vertical; outline:none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);"></textarea>
                </div>
                <div style="display:flex; gap:8px; margin-top:6px;">
                    <div id="fullscreenSourceCopy" style="width:38px; height:38px; border-radius:9px; border:1px solid rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; cursor:pointer; background: rgba(255,255,255,0.06);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </div>
                    <div id="fullscreenSourceSpeak" style="width:38px; height:38px; border-radius:9px; border:1px solid rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; cursor:pointer; background: rgba(255,255,255,0.06);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                        </svg>
                    </div>
                </div>
            </div>
            <div id="fullscreenSwap" title="Swap" style="align-self:center; width:40px; height:40px; border-radius:10px; background: transparent; border:none; box-shadow:none; display:flex; align-items:center; justify-content:center; cursor:pointer; transition: transform 0.2s ease;">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="17 1 21 5 17 9"></polyline>
                    <line x1="3" y1="5" x2="21" y2="5"></line>
                    <polyline points="7 23 3 19 7 15"></polyline>
                    <line x1="21" y1="19" x2="3" y2="19"></line>
                </svg>
            </div>
            <div style="flex:1; min-width:280px; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <label id="fullscreenTargetLabel" style="color:#cfd3ff; font-size:13px; font-weight:600; letter-spacing:0.2px;">${overlayLabels.target}</label>
                    <div id="fullscreenTargetPicker" style="position:relative;">
                        <button id="fullscreenTargetLangTrigger" style="display:flex; align-items:center; gap:6px; padding:6px 10px; border-radius:8px; background: rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.14); color:#fff; cursor:pointer; font-size:12px;">
                            <span id="fullscreenTargetLangCurrent">${getLanguageLabel(defaultTargetLang)}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        <div id="fullscreenTargetLangPanel" style="display:none; position:absolute; top:110%; right:0; width:280px; max-height:260px; background: rgba(30,30,47,0.98); border:1px solid rgba(255,255,255,0.12); box-shadow:0 10px 24px rgba(0,0,0,0.35); border-radius:10px; padding:8px; z-index:10002;">
                            <input id="fullscreenTargetLangSearch" placeholder="${langNames.navigator}" style="width:100%; max-width:100%; box-sizing:border-box; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); color:#fff; font-size:13px; outline:none;" />
                            <div id="fullscreenTargetLangGrid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:6px; max-height:190px; overflow-y:auto; padding-top:8px;"></div>
                        </div>
                    </div>
                </div>
                <select id="fullscreenTargetLang" style="display:none;">${targetLanguageOptionsHtml}</select>
                <div id="fullscreenTargetWrap" style="position:relative; flex:1; min-height:200px;">
                    <textarea id="fullscreenTarget" spellcheck="false" autocorrect="off" autocapitalize="off" style="width:100%; height:100%; min-height:200px; padding:12px; border-radius:10px; border:1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color:#fff; font-size:14px; line-height:1.5; resize: vertical; outline:none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);"></textarea>
                    <div id="utstFullscreenLoading" class="utst-modern-loader" data-mode="translate" aria-hidden="true" style="border-radius:10px;">
                        <div class="utst-modern-loader__card">
                            <div class="utst-modern-loader__ring"></div>
                            <div class="utst-modern-loader__body">
                                <div id="utstFullscreenLoadingTitle" class="utst-modern-loader__title">${overlayLabels.translate}...</div>
                                <div class="utst-modern-loader__line"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:8px; margin-top:6px;">
                    <div id="fullscreenTargetCopy" style="width:38px; height:38px; border-radius:9px; border:1px solid rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; cursor:pointer; background: rgba(255,255,255,0.06);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </div>
                    <div id="fullscreenTargetSpeak" style="width:38px; height:38px; border-radius:9px; border:1px solid rgba(255,255,255,0.16); display:flex; align-items:center; justify-content:center; cursor:pointer; background: rgba(255,255,255,0.06);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                        </svg>
                    </div>
                </div>
            </div>
        </div>
      </div>
    `;
        fullscreenOverlay.classList.add("utst-scroll");
        utstUiRoot.appendChild(fullscreenOverlay);

        function hydrateUtstLogoImages() {
            utstUiRoot.querySelectorAll('img[data-utst-logo-src]').forEach((img) => {
                if (!img || img.getAttribute('src')) return;
                img.src = img.getAttribute('data-utst-logo-src') || UTST_LOGO_URL;
            });
        }

        if (utstLogoLoaded) {
            hydrateUtstLogoImages();
        } else {
            window.addEventListener('utst-logo-loaded', hydrateUtstLogoImages, { once: true });
        }

        const selectionBubble = document.createElement('div');
        selectionBubble.id = 'utstSelectionBubble';
        selectionBubble.innerHTML = `
      <button id="utstSelectionBubbleClose" type="button" title="${langNames.bubble.closeTitle}" aria-label="${langNames.bubble.closeTitle}">×</button>
      <div id="utstSelectionBubbleDivider" aria-hidden="true"></div>
      <button id="utstSelectionBubbleAction" type="button" title="${langNames.bubble.translateTitle}" aria-label="${langNames.bubble.translateTitle}">
        <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 8l6 6"></path>
          <path d="M4 14l6-6 2-3"></path>
          <path d="M2 5h12"></path>
          <path d="M7 2h1"></path>
          <path d="M22 22l-5-10-5 10"></path>
          <path d="M14 18h6"></path>
        </svg>
      </button>
      <div id="utstBubbleCloseMenu">
        <button id="utstBubbleHideSite" class="utst-bubble-menu-btn" type="button">${langNames.bubble.hideSite}</button>
        <button id="utstBubbleHideGlobal" class="utst-bubble-menu-btn" type="button">${langNames.bubble.hideGlobal}</button>
      </div>
    `;
        utstUiRoot.appendChild(selectionBubble);

        const selectionBubbleClose = selectionBubble.querySelector('#utstSelectionBubbleClose');
        const selectionBubbleAction = selectionBubble.querySelector('#utstSelectionBubbleAction');
        const bubbleCloseMenu = selectionBubble.querySelector('#utstBubbleCloseMenu');
        const bubbleHideSiteButton = selectionBubble.querySelector('#utstBubbleHideSite');
        const bubbleHideGlobalButton = selectionBubble.querySelector('#utstBubbleHideGlobal');



        const BOX_W = 420;
        const BOX_H = 260;
        const MARGIN = 10;

        function placeBoxAtSelection(fallbackPosition) {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) {
                if (fallbackPosition && Number.isFinite(fallbackPosition.x) && Number.isFinite(fallbackPosition.y)) {
                    const { left, top } = clampBoxPosition(fallbackPosition.x, fallbackPosition.y + MARGIN);
                    translationBox.style.left = `${left}px`;
                    translationBox.style.top = `${top}px`;
                }
                return;
            }

            const rect = sel.getRangeAt(0).getBoundingClientRect();
            const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
            const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

            let left = rect.left + scrollX;
            const topBelow = rect.bottom + scrollY + MARGIN;
            const topAbove = rect.top + scrollY - BOX_H - MARGIN;

            const vpLeft = scrollX + MARGIN;
            const vpRight = scrollX + window.innerWidth - MARGIN;
            const vpBottom = scrollY + window.innerHeight - MARGIN;

            if (left + BOX_W > vpRight) left = vpRight - BOX_W;
            if (left < vpLeft) left = vpLeft;

            let top;
            if (topBelow + BOX_H <= vpBottom) {
                top = topBelow;
            } else {
                top = Math.max(topAbove, scrollY + MARGIN);
            }

            translationBox.style.left = `${left}px`;
            translationBox.style.top = `${top}px`;
        }

        const dragHandle = translationBox.querySelector('#dragHandle');
        let isDragging = false;
        let dragStartMouseX = 0;
        let dragStartMouseY = 0;
        let dragStartLeft = 0;
        let dragStartTop = 0;
        let previousUserSelect = '';

        function clampBoxPosition(left, top) {
            const width = translationBox.offsetWidth || BOX_W;
            const height = translationBox.offsetHeight || BOX_H;
            const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
            const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const minLeft = scrollX + MARGIN;
            const maxLeft = scrollX + window.innerWidth - width - MARGIN;
            const minTop = scrollY + MARGIN;
            const maxTop = scrollY + window.innerHeight - height - MARGIN;
            return {
                left: Math.min(Math.max(minLeft, left), maxLeft),
                top: Math.min(Math.max(minTop, top), maxTop)
            };
        }

        window.addEventListener('resize', () => {
            if (translationBox.style.display === 'block') placeBoxAtSelection();
        });

        if (dragHandle) {
            dragHandle.addEventListener('mousedown', (e) => {
                isDragging = true;
                const rect = translationBox.getBoundingClientRect();
                const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
                const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
                dragStartMouseX = e.clientX;
                dragStartMouseY = e.clientY;
                dragStartLeft = parseFloat(translationBox.style.left) || rect.left + scrollX;
                dragStartTop = parseFloat(translationBox.style.top) || rect.top + scrollY;
                previousUserSelect = document.body.style.userSelect;
                document.body.style.userSelect = 'none';
            });
        }

        document.addEventListener('mousemove', (e) => {
            if (fullscreenTextareaResizePending && fullscreenOverlay.style.display === 'flex' && fullscreenTextareaResizeActive) {
                if (!fullscreenTextareaResizeRaf) {
                    fullscreenTextareaResizeRaf = requestAnimationFrame(() => {
                        fullscreenTextareaResizeRaf = 0;
                        if (!fullscreenTextareaResizePending || !fullscreenTextareaResizeActive) return;
                        const liveHeight = Math.round(fullscreenTextareaResizeActive.getBoundingClientRect().height || 0);
                        if (liveHeight > 0 && Math.abs(liveHeight - fullscreenTextareaLastSyncedHeight) >= 1) {
                            syncFullscreenTextareaHeights(liveHeight);
                            fullscreenTextareaLastSyncedHeight = liveHeight;
                        }
                    });
                }
            }

            if (!isDragging) return;
            const newLeft = dragStartLeft + (e.clientX - dragStartMouseX);
            const newTop = dragStartTop + (e.clientY - dragStartMouseY);
            const { left, top } = clampBoxPosition(newLeft, newTop);
            translationBox.style.left = `${left}px`;
            translationBox.style.top = `${top}px`;
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            document.body.style.userSelect = previousUserSelect;
        });

        const sourceLangSelect = translationBox.querySelector('#sourceLang');
        const targetLangSelect = translationBox.querySelector('#targetLang');
        const translationText = translationBox.querySelector('#translationText');
        const panelLoadingOverlay = translationBox.querySelector('#utstPanelLoading');
        const panelLoadingTitle = translationBox.querySelector('#utstPanelLoadingTitle');
        const speakButton = translationBox.querySelector('#speakButton');
        const speakTooltip = translationBox.querySelector('#speakTooltip');
        const speakTranslated = translationBox.querySelector('#speakTranslated');
        const speakOriginal = translationBox.querySelector('#speakOriginal');
        const copyButton = translationBox.querySelector('#copyButton');
        const settingsButton = translationBox.querySelector('#settingsButton');
        const backButton = translationBox.querySelector('#backButton');
        const defaultTranslateLangSelect = translationBox.querySelector('#defaultTranslateLang');
        const defaultSourceLangSelect = translationBox.querySelector('#defaultSourceLang');
        const toolLanguageSelect = translationBox.querySelector('#toolLanguage');
        const panelThemeSelect = translationBox.querySelector('#panelTheme');
        const panelThemeTrigger = translationBox.querySelector('#panelThemeTrigger');
        const panelThemeCurrent = translationBox.querySelector('#panelThemeCurrent');
        const panelThemePanel = translationBox.querySelector('#panelThemePanel');
        const panelThemeGrid = translationBox.querySelector('#panelThemeGrid');
        if (panelThemePanel) {
            panelThemePanel.classList.add('utst-inline-lang-panel');
            utstUiRoot.appendChild(panelThemePanel);
        }
        const selectionBubbleEnabledCheckbox = translationBox.querySelector('#selectionBubbleEnabled');
        const bubbleBlacklistInput = translationBox.querySelector('#bubbleBlacklistInput');
        const bubbleBlacklistAddButton = translationBox.querySelector('#bubbleBlacklistAdd');
        const bubbleBlacklistList = translationBox.querySelector('#bubbleBlacklistList');
        const defaultTranslateLangLabel = translationBox.querySelector('label[for="defaultTranslateLang"]');
        const toolLanguageLabel = translationBox.querySelector('label[for="toolLanguage"]');
        const panelThemeLabel = translationBox.querySelector('label[for="panelTheme"]');
        const shortcutCaptureLabel = translationBox.querySelector('#shortcutCaptureLabel');
        const shortcutCaptureButton = translationBox.querySelector('#shortcutCaptureButton');
        const shortcutResetButton = translationBox.querySelector('#shortcutResetButton');
        const shortcutCaptureHelp = translationBox.querySelector('#shortcutCaptureHelp');
        const fieldShortcutCaptureButton = translationBox.querySelector('#fieldShortcutCaptureButton');
        const fieldShortcutResetButton = translationBox.querySelector('#fieldShortcutResetButton');
        const fieldShortcutCaptureHelp = translationBox.querySelector('#fieldShortcutCaptureHelp');
        const fieldTargetLangSelect = translationBox.querySelector('#fieldTargetLangSelect');
        const bubbleToggleLabel = translationBox.querySelector('label[for="selectionBubbleEnabled"] span');
        const bubbleBlacklistLabel = translationBox.querySelector('label[for="bubbleBlacklistInput"]');
        const sourceAutoOption = sourceLangSelect.querySelector('option[value="auto"]');
        const translatorPanel = translationBox.querySelector('#translatorPanel');
        const settingsPanel = translationBox.querySelector('#settingsPanel');
        const settingsHeader = translationBox.querySelector('#settingsHeader');
        const settingsHeaderTitle = translationBox.querySelector('#settingsHeaderTitle');
        const fullscreenTitleEl = fullscreenOverlay.querySelector('#fullscreenTitle');
        const fullscreenClose = fullscreenOverlay.querySelector('#fullscreenClose');
        const fullscreenSourceLangSelect = fullscreenOverlay.querySelector('#fullscreenSourceLang');
        const fullscreenTargetLangSelect = fullscreenOverlay.querySelector('#fullscreenTargetLang');
        const fullscreenSourceLangCurrent = fullscreenOverlay.querySelector('#fullscreenSourceLangCurrent');
        const fullscreenTargetLangCurrent = fullscreenOverlay.querySelector('#fullscreenTargetLangCurrent');
        const fullscreenSourceLangSearch = fullscreenOverlay.querySelector('#fullscreenSourceLangSearch');
        const fullscreenTargetLangSearch = fullscreenOverlay.querySelector('#fullscreenTargetLangSearch');
        const fullscreenSourceLangGrid = fullscreenOverlay.querySelector('#fullscreenSourceLangGrid');
        const fullscreenTargetLangGrid = fullscreenOverlay.querySelector('#fullscreenTargetLangGrid');
        const fullscreenSourceLangPanel = fullscreenOverlay.querySelector('#fullscreenSourceLangPanel');
        const fullscreenTargetLangPanel = fullscreenOverlay.querySelector('#fullscreenTargetLangPanel');
        const fullscreenSourceLangTrigger = fullscreenOverlay.querySelector('#fullscreenSourceLangTrigger');
        const fullscreenTargetLangTrigger = fullscreenOverlay.querySelector('#fullscreenTargetLangTrigger');
        const fullscreenPanel = fullscreenOverlay.querySelector('#fullscreenPanel');
        const fullscreenSourceLabel = fullscreenOverlay.querySelector('#fullscreenSourceLabel');
        const fullscreenTargetLabel = fullscreenOverlay.querySelector('#fullscreenTargetLabel');
        const fullscreenSwap = fullscreenOverlay.querySelector('#fullscreenSwap');
        const fullscreenSource = fullscreenOverlay.querySelector('#fullscreenSource');
        const fullscreenTarget = fullscreenOverlay.querySelector('#fullscreenTarget');
        const fullscreenSourceWrap = fullscreenOverlay.querySelector('#fullscreenSourceWrap');
        const fullscreenTargetWrap = fullscreenOverlay.querySelector('#fullscreenTargetWrap');
        const fullscreenLoadingOverlay = fullscreenOverlay.querySelector('#utstFullscreenLoading');
        const fullscreenLoadingTitle = fullscreenOverlay.querySelector('#utstFullscreenLoadingTitle');
        const fullscreenSourceCopy = fullscreenOverlay.querySelector('#fullscreenSourceCopy');
        const fullscreenSourceSpeak = fullscreenOverlay.querySelector('#fullscreenSourceSpeak');
        const fullscreenTargetCopy = fullscreenOverlay.querySelector('#fullscreenTargetCopy');
        const fullscreenTargetSpeak = fullscreenOverlay.querySelector('#fullscreenTargetSpeak');
        const fullscreenToggle = translationBox.querySelector('#fullscreenToggle');

        let fullscreenTextareaResizePending = false;
        let fullscreenTextareaResizeStartHeight = 0;
        let fullscreenTextareaResizeActive = null;
        let fullscreenTextareaResizeRaf = 0;
        let fullscreenTextareaLastSyncedHeight = 0;

        function getFullscreenTextareaBounds() {
            const minHeight = 200;
            const maxByViewport = Math.floor(window.innerHeight * 0.62);
            const maxHeight = Math.max(minHeight, Math.min(560, maxByViewport));
            return { minHeight, maxHeight };
        }

        function syncFullscreenTextareaHeights(preferredHeight = null) {
            if (!fullscreenSource || !fullscreenTarget) return;
            const { minHeight, maxHeight } = getFullscreenTextareaBounds();
            const sourceHeight = Math.round(fullscreenSource.getBoundingClientRect().height || minHeight);
            const targetHeight = Math.round(fullscreenTarget.getBoundingClientRect().height || minHeight);
            const rawHeight = Number.isFinite(preferredHeight) && preferredHeight > 0
                ? preferredHeight
                : Math.max(sourceHeight, targetHeight, minHeight);
            const clampedHeight = Math.max(minHeight, Math.min(maxHeight, Math.round(rawHeight)));

            fullscreenSource.style.minHeight = `${minHeight}px`;
            fullscreenTarget.style.minHeight = `${minHeight}px`;
            fullscreenSource.style.maxHeight = `${maxHeight}px`;
            fullscreenTarget.style.maxHeight = `${maxHeight}px`;
            fullscreenSource.style.height = `${clampedHeight}px`;
            fullscreenTarget.style.height = `${clampedHeight}px`;
            if (fullscreenSourceWrap) {
                fullscreenSourceWrap.style.height = `${clampedHeight}px`;
                fullscreenSourceWrap.style.minHeight = `${minHeight}px`;
                fullscreenSourceWrap.style.maxHeight = `${maxHeight}px`;
            }
            if (fullscreenTargetWrap) {
                fullscreenTargetWrap.style.height = `${clampedHeight}px`;
                fullscreenTargetWrap.style.minHeight = `${minHeight}px`;
                fullscreenTargetWrap.style.maxHeight = `${maxHeight}px`;
            }
        }

        sourceLangSelect.value = 'auto';

        const inlineLanguagePanels = [];
        let fullscreenSwapRotation = 0;

        let currentSelectedText = '';
        let currentTranslatedText = '';
        let detectedSourceLang = 'auto';
        let currentResolvedTargetLang = browserLang;
        let fullscreenTranslateTimer = null;
        let fullscreenTranslateReason = 'translate';
        let selectionBubbleUpdateTimer = null;
        let bubbleSelectedText = '';
        let bubbleSelectionPosition = null;
        let isSelectingPointer = false;
        let panelTranslateRequestId = 0;
        let fullscreenTranslateRequestId = 0;
        let fullscreenScrollLocked = false;
        let fullscreenScrollTop = 0;
        let prevHtmlOverflow = '';
        let prevHtmlOverscrollBehavior = '';
        let prevBodyOverflow = '';
        let prevBodyPosition = '';
        let prevBodyTop = '';
        let prevBodyLeft = '';
        let prevBodyWidth = '';
        let prevBodyOverscrollBehavior = '';
        let prevBodyTouchAction = '';

        const BUBBLE_ENABLED_KEY = 'selectionBubbleEnabled';
        const BUBBLE_BLACKLIST_KEY = 'selectionBubbleBlacklist';
        const PANEL_THEME_KEY = 'panelTheme';
        const SHORTCUT_KEY = 'selectionShortcut';
        const DEFAULT_SHORTCUT = Object.freeze({
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            key: 'l',
            code: 'KeyL',
            displayKey: 'L'
        });
        function getCurrentSiteHost() {
            return normalizeHostname(window.location.hostname || window.location.host || '');
        }

        const currentSiteHost = getCurrentSiteHost();
        let selectionBubbleEnabled = GM_getValue(BUBBLE_ENABLED_KEY, true) !== false;
        let selectionBubbleBlacklist = loadBubbleBlacklist();
        let currentPanelTheme = normalizePanelTheme(GM_getValue(PANEL_THEME_KEY, 'blue'));
        let shortcutCaptureActive = false;
        let keyboardLayoutMap = null;
        let currentShortcut = loadShortcutSetting();

        function cloneDefaultShortcut() {
            return { ...DEFAULT_SHORTCUT };
        }

        function getShortcutCodeFromLegacyKey(key) {
            const keyText = String(key || '');
            if (!keyText) return '';
            if (/^[a-z]$/i.test(keyText)) return `Key${keyText.toUpperCase()}`;
            if (/^[0-9]$/.test(keyText)) return `Digit${keyText}`;
            const specialKeys = {
                ' ': 'Space',
                space: 'Space',
                arrowup: 'ArrowUp',
                arrowdown: 'ArrowDown',
                arrowleft: 'ArrowLeft',
                arrowright: 'ArrowRight',
                escape: 'Escape',
                esc: 'Escape',
                enter: 'Enter',
                tab: 'Tab',
                backspace: 'Backspace',
                delete: 'Delete'
            };
            return specialKeys[keyText.toLowerCase()] || '';
        }

        function formatLayoutMapKey(value) {
            const text = String(value || '');
            if (!text) return '';
            return text.length === 1 ? text.toUpperCase() : text;
        }

        function getKeyboardLayoutLabel(code) {
            if (!keyboardLayoutMap || !code || typeof keyboardLayoutMap.get !== 'function') return '';
            return formatLayoutMapKey(keyboardLayoutMap.get(code));
        }

        function getAsciiFallbackKey(fallbackKey) {
            const keyText = String(fallbackKey || '');
            return keyText.length === 1 && !/[^\x20-\x7E]/.test(keyText) ? keyText.toUpperCase() : '';
        }

        function getLetterOrDigitCodeLabel(codeText, fallbackKey, prefixLength) {
            return getAsciiFallbackKey(fallbackKey) || codeText.slice(prefixLength);
        }

        function getSpecialCodeLabel(codeText) {
            const specialCodes = {
                ' ': 'Space',
                Space: 'Space',
                ArrowUp: 'Up',
                ArrowDown: 'Down',
                ArrowLeft: 'Left',
                ArrowRight: 'Right',
                Escape: 'Esc',
                Enter: 'Enter',
                Tab: 'Tab',
                Backspace: 'Backspace',
                Delete: 'Delete',
                Insert: 'Insert',
                Home: 'Home',
                End: 'End',
                PageUp: 'Page Up',
                PageDown: 'Page Down',
                Minus: '-',
                Equal: '=',
                BracketLeft: '[',
                BracketRight: ']',
                Backslash: '\\',
                Semicolon: ';',
                Quote: "'",
                Backquote: '`',
                Comma: ',',
                Period: '.',
                Slash: '/',
                NumpadAdd: 'Num +',
                NumpadSubtract: 'Num -',
                NumpadMultiply: 'Num *',
                NumpadDivide: 'Num /',
                NumpadDecimal: 'Num .',
                NumpadEnter: 'Num Enter'
            };
            return specialCodes[codeText] || '';
        }

        function refreshKeyboardLayoutMap() {
            if (!navigator.keyboard || typeof navigator.keyboard.getLayoutMap !== 'function') return Promise.resolve(null);
            return navigator.keyboard.getLayoutMap()
                .then((layoutMap) => {
                    keyboardLayoutMap = layoutMap;
                    currentShortcut = normalizeShortcutCandidate(currentShortcut);
                    GM_setValue(SHORTCUT_KEY, currentShortcut);
                    updateShortcutSettingsUi();
                    return layoutMap;
                })
                .catch(() => {
                    keyboardLayoutMap = null;
                    return null;
                });
        }

        function getDisplayKeyFromCode(code, fallbackKey = '') {
            const codeText = String(code || '');
            const layoutLabel = getKeyboardLayoutLabel(codeText);
            if (layoutLabel) return layoutLabel;
            if (/^Key[A-Z]$/.test(codeText)) return getLetterOrDigitCodeLabel(codeText, fallbackKey, 3);
            if (/^Digit[0-9]$/.test(codeText)) return getLetterOrDigitCodeLabel(codeText, fallbackKey, 5);
            if (/^Numpad[0-9]$/.test(codeText)) return `Num ${codeText.slice(6)}`;
            if (/^F([1-9]|1[0-9]|2[0-4])$/.test(codeText)) return codeText;

            const specialLabel = getSpecialCodeLabel(codeText);
            if (specialLabel) return specialLabel;

            const keyText = String(fallbackKey || '');
            return keyText.length === 1 ? keyText.toUpperCase() : keyText;
        }

        function normalizeShortcutCandidate(value) {
            if (!value || typeof value !== 'object') return cloneDefaultShortcut();
            const legacyKey = String(value.key || '').toLowerCase();
            const code = String(value.code || getShortcutCodeFromLegacyKey(legacyKey));
            const displayKey = getDisplayKeyFromCode(code, legacyKey);
            const shortcut = {
                ctrl: !!value.ctrl,
                alt: !!value.alt,
                shift: !!value.shift,
                meta: !!value.meta,
                key: legacyKey,
                code,
                displayKey
            };
            if (!shortcut.code || !hasShortcutModifier(shortcut) || isModifierShortcutCode(shortcut.code) || isModifierShortcutKey(shortcut.key)) {
                return cloneDefaultShortcut();
            }
            return shortcut;
        }

        function loadShortcutSetting() {
            const saved = GM_getValue(SHORTCUT_KEY, null);
            const normalized = normalizeShortcutCandidate(saved);
            if (!saved || JSON.stringify(saved) !== JSON.stringify(normalized)) {
                GM_setValue(SHORTCUT_KEY, normalized);
            }
            return normalized;
        }

        function saveShortcutSetting(shortcut) {
            currentShortcut = normalizeShortcutCandidate(shortcut);
            GM_setValue(SHORTCUT_KEY, currentShortcut);
            updateShortcutSettingsUi();
            return currentShortcut;
        }

        function isModifierShortcutKey(key) {
            return ['control', 'ctrl', 'shift', 'alt', 'meta', 'os'].includes(String(key || '').toLowerCase());
        }

        function isModifierShortcutCode(code) {
            return [
                'ControlLeft',
                'ControlRight',
                'ShiftLeft',
                'ShiftRight',
                'AltLeft',
                'AltRight',
                'MetaLeft',
                'MetaRight',
                'OSLeft',
                'OSRight'
            ].includes(String(code || ''));
        }

        function hasShortcutModifier(shortcut) {
            return !!(shortcut && (shortcut.ctrl || shortcut.alt || shortcut.shift || shortcut.meta));
        }

        function getShortcutLabels() {
            const fallback = languageNames.en || {};
            return {
                label: langNames.settingsShortcutLabel || fallback.settingsShortcutLabel || '',
                listening: langNames.settingsShortcutListening || fallback.settingsShortcutListening || '',
                help: langNames.settingsShortcutHelp || fallback.settingsShortcutHelp || '',
                invalid: langNames.settingsShortcutInvalid || fallback.settingsShortcutInvalid || '',
                saved: langNames.settingsShortcutSaved || fallback.settingsShortcutSaved || '',
                reset: langNames.settingsShortcutReset || fallback.settingsShortcutReset || ''
            };
        }

        function formatShortcut(shortcut) {
            const normalized = normalizeShortcutCandidate(shortcut);
            const uiCode = resolveUiLang(toolLanguagePreference);
            const shiftLabel = uiCode && uiCode.toLowerCase().startsWith('fr') ? 'Maj' : 'Shift';
            const metaLabel = navigator.platform && /mac/i.test(navigator.platform) ? 'Cmd' : 'Win';
            const parts = [];
            if (normalized.ctrl) parts.push('Ctrl');
            if (normalized.alt) parts.push('Alt');
            if (normalized.shift) parts.push(shiftLabel);
            if (normalized.meta) parts.push(metaLabel);
            parts.push(normalized.displayKey || normalized.key.toUpperCase());
            return parts.join(' + ');
        }

        function shortcutFromKeyboardEvent(e) {
            const key = String(e.key || '').toLowerCase();
            const code = String(e.code || getShortcutCodeFromLegacyKey(key));
            if (!code || isModifierShortcutCode(code) || isModifierShortcutKey(key)) return null;
            return {
                ctrl: !!e.ctrlKey,
                alt: !!e.altKey,
                shift: !!e.shiftKey,
                meta: !!e.metaKey,
                key,
                code,
                displayKey: getDisplayKeyFromCode(code, key)
            };
        }

        function shortcutMatchesEvent(shortcut, e) {
            const normalized = normalizeShortcutCandidate(shortcut);
            const eventCode = String(e && e.code || getShortcutCodeFromLegacyKey(e && e.key));
            return !!e
                && !!e.ctrlKey === normalized.ctrl
                && !!e.altKey === normalized.alt
                && !!e.shiftKey === normalized.shift
                && !!e.metaKey === normalized.meta
                && eventCode === normalized.code;
        }

        function updateShortcutSettingsUi(message = '') {
            if (!shortcutCaptureButton && !shortcutCaptureHelp && !shortcutCaptureLabel) return;
            const labels = getShortcutLabels();
            if (shortcutCaptureLabel) shortcutCaptureLabel.textContent = labels.label;
            if (shortcutCaptureButton) {
                shortcutCaptureButton.textContent = shortcutCaptureActive ? labels.listening : formatShortcut(currentShortcut);
                shortcutCaptureButton.classList.toggle('is-recording', shortcutCaptureActive);
                shortcutCaptureButton.setAttribute('aria-pressed', shortcutCaptureActive ? 'true' : 'false');
            }
            if (shortcutResetButton) {
                shortcutResetButton.title = labels.reset;
                shortcutResetButton.setAttribute('aria-label', labels.reset);
            }
            if (shortcutCaptureHelp) {
                shortcutCaptureHelp.textContent = message || labels.help;
            }
        }

        // ===== Отдельный хоткей для перевода текста в полях ввода (input/textarea/contenteditable) =====
        const FIELD_SHORTCUT_KEY = 'fieldTranslateShortcut';
        const DEFAULT_FIELD_SHORTCUT = Object.freeze({
            ctrl: true,
            alt: false,
            shift: false,
            meta: false,
            key: 'enter',
            code: 'Enter',
            displayKey: 'Enter'
        });
        function cloneDefaultFieldShortcut() {
            return { ...DEFAULT_FIELD_SHORTCUT };
        }
        function normalizeFieldShortcutCandidate(value) {
            if (!value || typeof value !== 'object') return cloneDefaultFieldShortcut();
            const legacyKey = String(value.key || '').toLowerCase();
            const code = String(value.code || getShortcutCodeFromLegacyKey(legacyKey));
            const displayKey = getDisplayKeyFromCode(code, legacyKey);
            const shortcut = {
                ctrl: !!value.ctrl,
                alt: !!value.alt,
                shift: !!value.shift,
                meta: !!value.meta,
                key: legacyKey,
                code,
                displayKey
            };
            if (!shortcut.code || !hasShortcutModifier(shortcut) || isModifierShortcutCode(shortcut.code) || isModifierShortcutKey(shortcut.key)) {
                return cloneDefaultFieldShortcut();
            }
            return shortcut;
        }
        function loadFieldShortcutSetting() {
            const saved = GM_getValue(FIELD_SHORTCUT_KEY, null);
            const normalized = normalizeFieldShortcutCandidate(saved);
            if (!saved || JSON.stringify(saved) !== JSON.stringify(normalized)) {
                GM_setValue(FIELD_SHORTCUT_KEY, normalized);
            }
            return normalized;
        }
        let fieldShortcutCaptureActive = false;
        let currentFieldShortcut = loadFieldShortcutSetting();
        function saveFieldShortcutSetting(shortcut) {
            currentFieldShortcut = normalizeFieldShortcutCandidate(shortcut);
            GM_setValue(FIELD_SHORTCUT_KEY, currentFieldShortcut);
            updateFieldShortcutSettingsUi();
            return currentFieldShortcut;
        }
        function updateFieldShortcutSettingsUi(message = '') {
            if (!fieldShortcutCaptureButton && !fieldShortcutCaptureHelp) return;
            if (fieldShortcutCaptureButton) {
                fieldShortcutCaptureButton.textContent = fieldShortcutCaptureActive ? 'Нажмите клавиши...' : formatShortcut(currentFieldShortcut);
                fieldShortcutCaptureButton.classList.toggle('is-recording', fieldShortcutCaptureActive);
                fieldShortcutCaptureButton.setAttribute('aria-pressed', fieldShortcutCaptureActive ? 'true' : 'false');
            }
            if (fieldShortcutCaptureHelp) {
                fieldShortcutCaptureHelp.textContent = message || 'Нажмите, затем введите сочетание с Ctrl, Alt, Shift или Cmd.';
            }
        }
        function bindFieldShortcutControls() {
            if (fieldShortcutCaptureButton) {
                fieldShortcutCaptureButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fieldShortcutCaptureActive = true;
                    updateFieldShortcutSettingsUi();
                    fieldShortcutCaptureButton.focus();
                });
                fieldShortcutCaptureButton.addEventListener('keydown', (e) => {
                    if (!fieldShortcutCaptureActive) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Escape' && !hasShortcutModifier({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })) {
                        fieldShortcutCaptureActive = false;
                        updateFieldShortcutSettingsUi();
                        return;
                    }
                    const candidate = shortcutFromKeyboardEvent(e);
                    if (!candidate || !hasShortcutModifier(candidate)) {
                        updateFieldShortcutSettingsUi('Добавьте хотя бы Ctrl, Alt, Shift или Cmd.');
                        return;
                    }
                    fieldShortcutCaptureActive = false;
                    saveFieldShortcutSetting(candidate);
                    updateFieldShortcutSettingsUi('Сочетание сохранено.');
                });
                fieldShortcutCaptureButton.addEventListener('blur', () => {
                    if (!fieldShortcutCaptureActive) return;
                    fieldShortcutCaptureActive = false;
                    updateFieldShortcutSettingsUi();
                });
            }
            if (fieldShortcutResetButton) {
                fieldShortcutResetButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    fieldShortcutCaptureActive = false;
                    saveFieldShortcutSetting(cloneDefaultFieldShortcut());
                });
            }
        }
        bindFieldShortcutControls();
        updateFieldShortcutSettingsUi();

        if (fieldTargetLangSelect) {
            const savedFieldTargetLang = GM_getValue('fieldTargetLang', defaultTargetLang);
            ensureSelectValue(fieldTargetLangSelect, savedFieldTargetLang);
            fieldTargetLangSelect.addEventListener('change', () => {
                GM_setValue('fieldTargetLang', fieldTargetLangSelect.value);
            });
        }
        function getFieldTargetLanguage() {
            let val = GM_getValue('fieldTargetLang', defaultTargetLang);
            if (val === 'navigator' || !val) val = browserLang;
            return val;
        }

        const pageTranslateAutoToggle = translationBox.querySelector('#pageTranslateAutoToggle');
        const pageTranslateLangSelect = translationBox.querySelector('#pageTranslateLang');
        const pageTranslateEngineSelect = translationBox.querySelector('#pageTranslateEngine');
        if (pageTranslateAutoToggle) {
            pageTranslateAutoToggle.checked = GM_getValue('pageTranslateAuto', false);
            pageTranslateAutoToggle.addEventListener('change', () => GM_setValue('pageTranslateAuto', pageTranslateAutoToggle.checked));
        }
        if (pageTranslateLangSelect) {
            ensureSelectValue(pageTranslateLangSelect, GM_getValue('pageTranslateLang', defaultTargetLang));
            pageTranslateLangSelect.addEventListener('change', () => GM_setValue('pageTranslateLang', pageTranslateLangSelect.value));
        }
        if (pageTranslateEngineSelect) {
            pageTranslateEngineSelect.value = GM_getValue('pageTranslateEngine', 'google');
            pageTranslateEngineSelect.addEventListener('change', () => GM_setValue('pageTranslateEngine', pageTranslateEngineSelect.value));
        }

        const areaPickButtonEl = translationBox.querySelector('#areaPickButton');
        const areaZoneStatusEl = translationBox.querySelector('#areaZoneStatus');
        const areaZoneEnabledToggleEl = translationBox.querySelector('#areaZoneEnabledToggle');
        const areaZoneClearButtonEl = translationBox.querySelector('#areaZoneClearButton');
        const areaTranslateLangSelectEl = translationBox.querySelector('#areaTranslateLang');
        const areaTranslateEngineSelectEl = translationBox.querySelector('#areaTranslateEngine');

        function refreshAreaZoneSettingsUi() {
            const cfg = getAreaZoneConfig();
            if (areaZoneStatusEl) {
                areaZoneStatusEl.textContent = cfg
                    ? `Область задана на этом сайте (${cfg.enabled ? 'включена' : 'выключена'})`
                    : 'На этом сайте область ещё не выбрана';
            }
            if (areaZoneEnabledToggleEl) areaZoneEnabledToggleEl.checked = !!(cfg && cfg.enabled);
            if (areaTranslateLangSelectEl) ensureSelectValue(areaTranslateLangSelectEl, (cfg && cfg.targetLang) || GM_getValue('areaTranslateLangDefault', defaultTargetLang));
            if (areaTranslateEngineSelectEl) areaTranslateEngineSelectEl.value = (cfg && cfg.engine) || GM_getValue('areaTranslateEngineDefault', 'google');
        }
        refreshAreaZoneSettingsUi();

        if (areaPickButtonEl) {
            areaPickButtonEl.addEventListener('click', () => {
                translationBox.style.display = 'none';
                startAreaPicker(() => {
                    translationBox.style.display = 'block';
                    refreshAreaZoneSettingsUi();
                });
            });
        }
        if (areaZoneEnabledToggleEl) {
            areaZoneEnabledToggleEl.addEventListener('change', () => {
                const cfg = getAreaZoneConfig();
                if (!cfg) { areaZoneEnabledToggleEl.checked = false; return; }
                cfg.enabled = areaZoneEnabledToggleEl.checked;
                setAreaZoneConfig(location.hostname, cfg);
                if (cfg.enabled) activateAreaZone(cfg.selector, cfg.targetLang, cfg.engine);
                else deactivateAreaZone();
                refreshAreaZoneSettingsUi();
            });
        }
        if (areaZoneClearButtonEl) {
            areaZoneClearButtonEl.addEventListener('click', () => {
                setAreaZoneConfig(location.hostname, null);
                deactivateAreaZone();
                refreshAreaZoneSettingsUi();
                showPageTranslateStatus('Область забыта для этого сайта', true);
            });
        }
        if (areaTranslateLangSelectEl) {
            areaTranslateLangSelectEl.addEventListener('change', () => {
                GM_setValue('areaTranslateLangDefault', areaTranslateLangSelectEl.value);
                const cfg = getAreaZoneConfig();
                if (cfg) {
                    cfg.targetLang = areaTranslateLangSelectEl.value;
                    setAreaZoneConfig(location.hostname, cfg);
                    if (cfg.enabled) activateAreaZone(cfg.selector, cfg.targetLang, cfg.engine);
                }
            });
        }
        if (areaTranslateEngineSelectEl) {
            areaTranslateEngineSelectEl.addEventListener('change', () => {
                GM_setValue('areaTranslateEngineDefault', areaTranslateEngineSelectEl.value);
                const cfg = getAreaZoneConfig();
                if (cfg) {
                    cfg.engine = areaTranslateEngineSelectEl.value;
                    setAreaZoneConfig(location.hostname, cfg);
                    if (cfg.enabled) activateAreaZone(cfg.selector, cfg.targetLang, cfg.engine);
                }
            });
        }

        function normalizePanelTheme(value) {
            return value === 'dark' || value === 'light' ? value : 'blue';
        }

        function getThemeSwatchStyle(themeValue) {
            const normalized = normalizePanelTheme(themeValue);
            if (normalized === 'dark') {
                return '--utst-theme-swatch-bg:#111827;--utst-theme-swatch-border:#475569;';
            }
            if (normalized === 'light') {
                return '--utst-theme-swatch-bg:#f8fafc;--utst-theme-swatch-border:#cbd5e1;';
            }
            return '--utst-theme-swatch-bg:linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);--utst-theme-swatch-border:#7db7ff;';
        }

        function getThemeLabelMarkup(themeValue) {
            const normalized = normalizePanelTheme(themeValue);
            return `<span class="utst-theme-swatch" style="${getThemeSwatchStyle(normalized)}"></span><span>${getThemeDisplayLabel(normalized)}</span>`;
        }

        function getIconDefaultStrokeColor() {
            if (currentPanelTheme === 'light') return '#4a5568';
            if (currentPanelTheme === 'blue') return '#eaf2ff';
            return '#f0f0f0';
        }

        const COPY_FEEDBACK_STROKE = 'rgb(64 130 243)';
        let speechStateReady = false;

        function applyIconThemeColors() {
            const defaultStroke = getIconDefaultStrokeColor();
            [speakButton, copyButton, fullscreenToggle, settingsButton, backButton, fullscreenSwap,
                fullscreenSourceCopy, fullscreenSourceSpeak, fullscreenTargetCopy, fullscreenTargetSpeak
            ].forEach((buttonEl) => {
                if (!buttonEl) return;
                buttonEl.querySelectorAll('svg, svg path, svg line, svg rect, svg polyline').forEach((node) => {
                    node.style.stroke = defaultStroke;
                });
            });
            const closeSvg = translationBox.querySelector('#closeButton svg');
            if (closeSvg) closeSvg.style.stroke = '#ff4d4d';
            const fullscreenCloseSvg = fullscreenOverlay.querySelector('#fullscreenClose svg');
            if (fullscreenCloseSvg) fullscreenCloseSvg.style.stroke = '#ff6b6b';
            if (speechStateReady) updateSpeechIconState();
        }

        function setButtonIconStroke(buttonEl, stroke) {
            if (!buttonEl) return;
            buttonEl.querySelectorAll('svg, svg path, svg line, svg rect, svg polyline').forEach((node) => {
                node.style.stroke = stroke;
            });
        }

        function lockPageScrollForFullscreen() {
            if (fullscreenScrollLocked) return;
            const scrollY = window.scrollY || window.pageYOffset || 0;
            fullscreenScrollTop = scrollY;

            prevHtmlOverflow = document.documentElement.style.overflow;
            prevHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior;
            prevBodyOverflow = document.body.style.overflow;
            prevBodyPosition = document.body.style.position;
            prevBodyTop = document.body.style.top;
            prevBodyLeft = document.body.style.left;
            prevBodyWidth = document.body.style.width;
            prevBodyOverscrollBehavior = document.body.style.overscrollBehavior;
            prevBodyTouchAction = document.body.style.touchAction;

            document.documentElement.style.overflow = 'hidden';
            document.documentElement.style.overscrollBehavior = 'none';
            document.body.style.overflow = 'hidden';
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.left = '0';
            document.body.style.width = '100%';
            document.body.style.overscrollBehavior = 'none';
            document.body.style.touchAction = 'none';
            fullscreenScrollLocked = true;
        }

        function unlockPageScrollForFullscreen() {
            if (!fullscreenScrollLocked) return;
            document.documentElement.style.overflow = prevHtmlOverflow;
            document.documentElement.style.overscrollBehavior = prevHtmlOverscrollBehavior;
            document.body.style.overflow = prevBodyOverflow;
            document.body.style.position = prevBodyPosition;
            document.body.style.top = prevBodyTop;
            document.body.style.left = prevBodyLeft;
            document.body.style.width = prevBodyWidth;
            document.body.style.overscrollBehavior = prevBodyOverscrollBehavior;
            document.body.style.touchAction = prevBodyTouchAction;
            window.scrollTo(0, fullscreenScrollTop);
            fullscreenScrollLocked = false;
        }

        function resolveTargetLanguageValue(value, fallback = defaultTargetLang) {
            let lang = value || fallback;
            if (lang === 'navigator') return browserLang;
            if (!lang || lang === 'auto') lang = fallback;
            if (lang === 'navigator') return browserLang;
            return lang || browserLang;
        }

        function resolveSourceSpeechLanguage(sourceValue) {
            if (sourceValue && sourceValue !== 'auto') return sourceValue;
            if (detectedSourceLang && detectedSourceLang !== 'auto') return detectedSourceLang;
            if (sourceLangSelect && sourceLangSelect.value && sourceLangSelect.value !== 'auto') return sourceLangSelect.value;
            return browserLang;
        }

        function resolveTargetSpeechLanguage(targetValue, fallback = currentResolvedTargetLang) {
            return resolveTargetLanguageValue(targetValue, fallback || browserLang);
        }

        function getDetectedSourceLanguageLabel() {
            if (!detectedSourceLang || detectedSourceLang === 'auto') return '';
            return getLanguageLabel(detectedSourceLang);
        }

        function getFullscreenSourceCurrentLabel(code) {
            if (code === 'auto') {
                const detectedLabel = getDetectedSourceLanguageLabel();
                return detectedLabel ? `${langNames.auto} (${detectedLabel})` : (langNames.auto || 'Detect language');
            }
            return getLanguageLabel(code);
        }

        function updateFullscreenSourceCurrentLabel() {
            if (!fullscreenSourceLangCurrent || !fullscreenSourceLangSelect) return;
            const sourceCode = fullscreenSourceLangSelect.value || 'auto';
            fullscreenSourceLangCurrent.textContent = getFullscreenSourceCurrentLabel(sourceCode);
        }

        function updateFullscreenTargetCurrentLabel() {
            if (!fullscreenTargetLangCurrent || !fullscreenTargetLangSelect) return;
            const targetCode = fullscreenTargetLangSelect.value || defaultTargetLang;
            fullscreenTargetLangCurrent.textContent = getLanguageLabel(targetCode);
        }

        function ensureFullscreenTargetLanguageValid(preferred) {
            if (!fullscreenTargetLangSelect) return resolveTargetLanguageValue(preferred, defaultTargetLang);
            const candidate = resolveTargetLanguageValue(preferred, defaultTargetLang);
            return ensureSelectValue(fullscreenTargetLangSelect, candidate);
        }

        function getLoaderTitleByMode(mode = 'translate') {
            const translateLabel = (overlayLabels && overlayLabels.translate) || (langNames.overlay && langNames.overlay.translate) || 'Translate';
            if (mode === 'language') {
                return `${translateLabel}...`;
            }
            return `${translateLabel}...`;
        }

        function syncLoadingTitles() {
            if (panelLoadingTitle) panelLoadingTitle.textContent = getLoaderTitleByMode(panelLoadingOverlay && panelLoadingOverlay.dataset.mode ? panelLoadingOverlay.dataset.mode : 'translate');
            if (fullscreenLoadingTitle) fullscreenLoadingTitle.textContent = getLoaderTitleByMode(fullscreenLoadingOverlay && fullscreenLoadingOverlay.dataset.mode ? fullscreenLoadingOverlay.dataset.mode : 'translate');
        }

        function setLoaderState(loaderEl, titleEl, active, mode = 'translate') {
            if (!loaderEl) return;
            loaderEl.dataset.mode = mode === 'language' ? 'language' : 'translate';
            loaderEl.classList.toggle('is-active', !!active);
            loaderEl.setAttribute('aria-hidden', active ? 'false' : 'true');
            if (titleEl) {
                titleEl.textContent = getLoaderTitleByMode(loaderEl.dataset.mode);
            }
        }

        function setPanelLoading(active, mode = 'translate') {
            setLoaderState(panelLoadingOverlay, panelLoadingTitle, active, mode);
        }

        function setFullscreenLoading(active, mode = 'translate') {
            setLoaderState(fullscreenLoadingOverlay, fullscreenLoadingTitle, active, mode);
        }

        function runPanelTranslation(text, sourceLang, targetLang, callback, position, loadingMode = 'translate', engine) {
            const requestId = ++panelTranslateRequestId;
            setPanelLoading(true, loadingMode);
            translateText(text, sourceLang, targetLang, (translation, pos, resolvedTargetLang) => {
                if (requestId !== panelTranslateRequestId) return;
                setPanelLoading(false, loadingMode);
                callback(translation, pos, resolvedTargetLang);
            }, position, engine);
        }

        function applyPanelTheme(theme, { persist = false } = {}) {
            const normalizedTheme = normalizePanelTheme(theme);
            currentPanelTheme = normalizedTheme;
            if (persist) {
                GM_setValue(PANEL_THEME_KEY, normalizedTheme);
            }
            document.documentElement.classList.remove('utst-theme-blue', 'utst-theme-dark', 'utst-theme-light');
            document.documentElement.classList.add(`utst-theme-${normalizedTheme}`);
            if (utstUi.host) {
                utstUi.host.classList.remove('utst-theme-blue', 'utst-theme-dark', 'utst-theme-light');
                utstUi.host.classList.add(`utst-theme-${normalizedTheme}`);
            }
            if (panelThemeSelect) {
                panelThemeSelect.value = normalizedTheme;
            }
            applyIconThemeColors();
            updateThemePickerCurrentLabel();
            refreshLanguagePanelTheme();
        }

        function getThemeDisplayLabel(themeValue) {
            const normalized = normalizePanelTheme(themeValue);
            const localizedThemes = langNames.themes || languageNames.en.themes || {};
            return localizedThemes[normalized] || normalized;
        }

        function updateThemePickerCurrentLabel() {
            if (!panelThemeCurrent) return;
            const selected = panelThemeSelect ? normalizePanelTheme(panelThemeSelect.value || currentPanelTheme) : currentPanelTheme;
            panelThemeCurrent.innerHTML = getThemeLabelMarkup(selected);
        }

        function renderThemePickerOptions() {
            if (!panelThemeGrid || !panelThemeSelect || !panelThemePanel) return;
            const style = getThemePanelThemeStyles();
            applyThemePanelContainerTheme();
            const selected = normalizePanelTheme(panelThemeSelect.value || currentPanelTheme);
            const isLightTheme = currentPanelTheme === 'light';
            const options = ['blue', 'dark', 'light'];
            panelThemeGrid.innerHTML = options.map((value) => {
                const active = value === selected;
                const activeBorder = isLightTheme ? '#2d5cbe' : style.buttonActiveBorder;
                const idleBorder = isLightTheme ? '#94a3b8' : style.buttonBorder;
                const activeShadow = isLightTheme
                    ? 'inset 0 0 0 1px rgba(38,61,104,0.28), 0 0 0 1px rgba(38,61,104,0.18)'
                    : (style.buttonActiveShadow || 'none');
                return `<button type="button" data-theme="${value}" style="
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    gap:8px;
                    padding:6px 8px;
                    text-align:left;
                    border-radius:8px;
                    border:1px solid ${active ? activeBorder : idleBorder};
                    background:${active ? style.buttonActiveBg : style.buttonBg};
                    color:${active && style.buttonActiveColor ? style.buttonActiveColor : style.buttonColor};
                    font-weight:${active ? (style.buttonActiveWeight || 600) : (style.buttonWeight || 500)};
                    box-shadow:${active ? activeShadow : 'none'};
                    cursor:pointer;
                    font-size:12px;
                    transition:background 0.15s ease, border 0.15s ease;
                "><span class="utst-theme-option-label">${getThemeLabelMarkup(value)}</span></button>`;
            }).join('');

            panelThemeGrid.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const theme = btn.getAttribute('data-theme') || 'blue';
                    panelThemeSelect.value = normalizePanelTheme(theme);
                    applyPanelTheme(panelThemeSelect.value, { persist: true });
                    if (panelThemePanel) panelThemePanel.style.display = 'none';
                });
            });
        }

        function positionThemePanel() {
            if (!panelThemePanel || panelThemePanel.style.display !== 'block' || !panelThemeTrigger) return;
            const rect = panelThemeTrigger.getBoundingClientRect();
            const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
            const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const width = Math.round(rect.width || 260);
            const panelWidth = Math.max(width, 220);
            const left = Math.min(rect.left + scrollX, scrollX + window.innerWidth - panelWidth - 10);
            const top = rect.bottom + scrollY + 6;
            panelThemePanel.style.position = 'absolute';
            panelThemePanel.style.left = `${Math.max(scrollX + 10, left)}px`;
            panelThemePanel.style.top = `${top}px`;
            panelThemePanel.style.right = 'auto';
            panelThemePanel.style.width = `${panelWidth}px`;
            panelThemePanel.style.maxWidth = `${Math.max(180, window.innerWidth - 20)}px`;
            panelThemePanel.style.zIndex = '2147483646';
        }

        function getLanguagePanelThemeStyles() {
            if (currentPanelTheme === 'light') {
                return {
                    panelBg: 'rgba(255,255,255,0.98)',
                    panelBorder: 'rgba(36,58,99,0.18)',
                    panelShadow: '0 10px 24px rgba(18,27,44,0.18)',
                    searchBg: 'rgba(255,255,255,0.96)',
                    searchBorder: 'rgba(38,61,104,0.2)',
                    searchColor: '#203150',
                    buttonBg: 'rgba(45,92,190,0.06)',
                    buttonBorder: 'rgba(38,61,104,0.2)',
                    buttonColor: '#203150',
                    buttonActiveBg: 'rgba(45,92,190,0.22)',
                    buttonActiveBorder: 'rgba(38,61,104,0.5)',
                    buttonActiveColor: '#16386c',
                    buttonWeight: 500,
                    buttonActiveWeight: 650,
                    buttonActiveShadow: 'inset 0 0 0 1px rgba(38,61,104,0.12)'
                };
            }

            if (currentPanelTheme === 'dark') {
                return {
                    panelBg: 'rgba(18,18,18,0.98)',
                    panelBorder: 'rgba(255,255,255,0.08)',
                    panelShadow: '0 10px 24px rgba(0,0,0,0.45)',
                    searchBg: 'rgba(255,255,255,0.06)',
                    searchBorder: 'rgba(255,255,255,0.12)',
                    searchColor: '#f0f0f0',
                    buttonBg: 'rgba(255,255,255,0.03)',
                    buttonBorder: 'rgba(255,255,255,0.1)',
                    buttonColor: '#f0f0f0',
                    buttonActiveBg: 'rgba(255,255,255,0.14)',
                    buttonActiveBorder: 'rgba(255,255,255,0.32)',
                    buttonWeight: 500,
                    buttonActiveWeight: 600
                };
            }

            return {
                panelBg: 'linear-gradient(135deg, #1e1e2f 0%, #2a2a4a 100%)',
                panelBorder: 'rgba(255, 255, 255, 0.10)',
                panelShadow: '0 12px 32px rgba(0, 0, 0, 0.45)',
                searchBg: 'rgba(255, 255, 255, 0.07)',
                searchBorder: 'rgba(255, 255, 255, 0.14)',
                searchColor: '#ffffff',
                buttonBg: 'rgba(255, 255, 255, 0.06)',
                buttonBorder: 'rgba(255, 255, 255, 0.16)',
                buttonColor: '#ffffff',
                buttonActiveBg: 'rgba(74, 144, 226, 0.34)',
                buttonActiveBorder: 'rgba(139, 177, 255, 0.72)',
                buttonActiveColor: '#ffffff',
                buttonWeight: 500,
                buttonActiveWeight: 650,
                buttonActiveShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.10), 0 0 0 1px rgba(74, 144, 226, 0.16)'
            };
        }

        function getThemePanelThemeStyles() {
            return getLanguagePanelThemeStyles();
        }

        function applyLanguagePanelContainerTheme(panelEl, searchEl) {
            if (!panelEl) return;
            const style = getLanguagePanelThemeStyles();
            panelEl.style.background = style.panelBg;
            panelEl.style.border = `1px solid ${style.panelBorder}`;
            panelEl.style.boxShadow = style.panelShadow;

            if (searchEl) {
                searchEl.style.background = style.searchBg;
                searchEl.style.border = `1px solid ${style.searchBorder}`;
                searchEl.style.color = style.searchColor;
            }
        }

        function applyThemePanelContainerTheme() {
            if (!panelThemePanel) return;
            const style = getThemePanelThemeStyles();
            panelThemePanel.style.background = style.panelBg;
            panelThemePanel.style.border = `1px solid ${style.panelBorder}`;
            panelThemePanel.style.boxShadow = style.panelShadow;
        }

        function renderInlineLanguageGridForTheme(panel, selectEl) {
            if (!panel || !selectEl) return;
            const searchEl = panel.querySelector('.inlineLangSearch');
            const gridEl = panel.querySelector('.inlineLangGrid');
            if (!gridEl) return;
            const shouldRender = panel.style.display === 'block' || gridEl.childElementCount > 0;
            if (!shouldRender) return;
            const opts = Array.from(selectEl.options)
                .filter(o => !o.disabled)
                .map(o => ({ value: o.value, label: o.textContent || o.value }));
            renderLanguageGrid(gridEl, searchEl, selectEl, null, panel, opts);
        }

        function refreshLanguagePanelTheme() {
            applyLanguagePanelContainerTheme(fullscreenSourceLangPanel, fullscreenSourceLangSearch);
            applyLanguagePanelContainerTheme(fullscreenTargetLangPanel, fullscreenTargetLangSearch);
            applyThemePanelContainerTheme();
            if (fullscreenSourceLangGrid && fullscreenSourceLangSelect
                && (fullscreenSourceLangPanel.style.display === 'block' || fullscreenSourceLangGrid.childElementCount > 0)) {
                renderLanguageGrid(fullscreenSourceLangGrid, fullscreenSourceLangSearch, fullscreenSourceLangSelect, fullscreenSourceLangCurrent, fullscreenSourceLangPanel);
            }
            if (fullscreenTargetLangGrid && fullscreenTargetLangSelect
                && (fullscreenTargetLangPanel.style.display === 'block' || fullscreenTargetLangGrid.childElementCount > 0)) {
                renderLanguageGrid(fullscreenTargetLangGrid, fullscreenTargetLangSearch, fullscreenTargetLangSelect, fullscreenTargetLangCurrent, fullscreenTargetLangPanel);
            }
            if (panelThemePanel && panelThemeGrid && (panelThemePanel.style.display === 'block' || panelThemeGrid.childElementCount > 0)) {
                renderThemePickerOptions();
            }
            inlineLanguagePanels.forEach(({ panel }) => {
                const searchEl = panel.querySelector('.inlineLangSearch');
                applyLanguagePanelContainerTheme(panel, searchEl);
            });
            inlineLanguagePanels.forEach(({ panel, selectEl }) => {
                renderInlineLanguageGridForTheme(panel, selectEl);
            });
        }

        function normalizeHostname(value) {
            if (value == null) return '';
            let host = String(value).trim().toLowerCase();
            if (!host) return '';
            host = host.replace(/^\*\./, '');
            if (host.includes('://')) {
                try {
                    host = new URL(host).hostname.toLowerCase();
                } catch (e) {
                    host = host.split('://').pop();
                }
            }
            host = host.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
            host = host.replace(/^www\./, '');
            return host;
        }

        function loadBubbleBlacklist() {
            const stored = GM_getValue(BUBBLE_BLACKLIST_KEY, []);
            const list = Array.isArray(stored)
                ? stored
                : typeof stored === 'string'
                    ? stored.split(',').map(v => v.trim())
                    : [];
            const normalized = [...new Set(list.map(normalizeHostname).filter(Boolean))];
            GM_setValue(BUBBLE_BLACKLIST_KEY, normalized);
            return normalized;
        }

        function persistBubbleBlacklist() {
            GM_setValue(BUBBLE_BLACKLIST_KEY, selectionBubbleBlacklist);
        }

        function persistSelectionBubbleEnabled() {
            GM_setValue(BUBBLE_ENABLED_KEY, selectionBubbleEnabled);
        }

        function isCurrentSiteBlacklisted() {
            if (!currentSiteHost) return false;
            return selectionBubbleBlacklist.some(site => currentSiteHost === site || currentSiteHost.endsWith(`.${site}`));
        }

        function canShowSelectionBubble() {
            return selectionBubbleEnabled && !isCurrentSiteBlacklisted();
        }

        function getFocusSelectionRect(selection) {
            try {
                if (!selection.focusNode) return null;
                const focusRange = document.createRange();
                focusRange.setStart(selection.focusNode, selection.focusOffset);
                focusRange.setEnd(selection.focusNode, selection.focusOffset);
                const focusRect = focusRange.getBoundingClientRect();
                if (focusRect && (focusRect.width || focusRect.height)) {
                    return focusRect;
                }
            } catch (e) {
                return null;
            }
            return null;
        }

        function getLastRangeClientRect(range) {
            const clientRects = range.getClientRects();
            return clientRects && clientRects.length ? clientRects[clientRects.length - 1] : null;
        }

        function isUsableSelectionRect(rect) {
            return !!(rect && (rect.width || rect.height));
        }

        function getSelectionContext() {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
            const text = sel.toString().trim();
            if (!text) return null;
            const range = sel.getRangeAt(0);
            const rect = getFocusSelectionRect(sel) || getLastRangeClientRect(range) || range.getBoundingClientRect();

            if (!isUsableSelectionRect(rect)) return null;
            return {
                text,
                rect,
                position: {
                    x: rect.right + window.scrollX,
                    y: rect.bottom + window.scrollY
                }
            };
        }

        function hideBubbleCloseMenu() {
            if (!bubbleCloseMenu) return;
            bubbleCloseMenu.classList.remove('utst-open');
        }

        function hideSelectionBubble() {
            selectionBubble.classList.remove('utst-visible');
            bubbleSelectedText = '';
            bubbleSelectionPosition = null;
            hideBubbleCloseMenu();
        }

        function positionSelectionBubble(rect) {
            if (!rect) return;
            const bubbleWidth = selectionBubble.offsetWidth || 120;
            const bubbleHeight = selectionBubble.offsetHeight || 38;
            const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
            const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const minLeft = scrollX + MARGIN;
            const maxLeft = scrollX + window.innerWidth - bubbleWidth - MARGIN;
            const belowTop = rect.bottom + scrollY + 8;
            const aboveTop = rect.top + scrollY - bubbleHeight - 8;
            const maxTop = scrollY + window.innerHeight - bubbleHeight - MARGIN;
            const minTop = scrollY + MARGIN;
            const anchorLeft = rect.right + scrollX - (bubbleWidth / 2);

            let top = belowTop;
            if (top > maxTop) {
                top = Math.max(minTop, aboveTop);
            }

            const left = Math.min(Math.max(anchorLeft, minLeft), maxLeft);
            selectionBubble.style.left = `${left}px`;
            selectionBubble.style.top = `${Math.min(Math.max(top, minTop), maxTop)}px`;
        }

        function isSelectionInsideTool() {
            const sel = window.getSelection();
            if (!sel) return false;
            const anchor = sel.anchorNode;
            const focus = sel.focusNode;
            const nodes = [anchor, focus].filter(Boolean);
            return nodes.some(node => {
                const el = node.nodeType === 1 ? node : node.parentElement;
                return el && (translationBox.contains(el) || fullscreenOverlay.contains(el) || selectionBubble.contains(el));
            });
        }

        function isFullscreenOpen() {
            return fullscreenOverlay && fullscreenOverlay.style.display === 'flex';
        }

        function updateSelectionBubble() {
            if (isSelectingPointer) {
                hideSelectionBubble();
                return;
            }
            if (translationBox.style.display === 'block' || isFullscreenOpen()) {
                hideSelectionBubble();
                return;
            }
            if (!canShowSelectionBubble() || isSelectionInsideTool()) {
                hideSelectionBubble();
                return;
            }
            const context = getSelectionContext();
            if (!context) {
                hideSelectionBubble();
                return;
            }

            bubbleSelectedText = context.text;
            bubbleSelectionPosition = context.position;
            positionSelectionBubble(context.rect);
            selectionBubble.classList.add('utst-visible');
        }

        function scheduleSelectionBubbleUpdate(delay = 20) {
            if (isFullscreenOpen()) {
                if (selectionBubbleUpdateTimer) {
                    clearTimeout(selectionBubbleUpdateTimer);
                    selectionBubbleUpdateTimer = null;
                }
                hideSelectionBubble();
                return;
            }
            if (selectionBubbleUpdateTimer) clearTimeout(selectionBubbleUpdateTimer);
            selectionBubbleUpdateTimer = setTimeout(() => {
                selectionBubbleUpdateTimer = null;
                updateSelectionBubble();
            }, delay);
        }

        function renderBubbleBlacklist() {
            if (!bubbleBlacklistList) return;
            if (!selectionBubbleBlacklist.length) {
                bubbleBlacklistList.innerHTML = `<div class="utst-blacklist-empty">${langNames.settingsBlacklistEmpty}</div>`;
                return;
            }
            bubbleBlacklistList.innerHTML = selectionBubbleBlacklist
                .map(site => `
                <div class="utst-blacklist-item">
                    <span>${site}</span>
                    <button class="utst-blacklist-remove" type="button" data-site="${site}" title="Remove">×</button>
                </div>
            `)
                .join('');

            bubbleBlacklistList.querySelectorAll('.utst-blacklist-remove').forEach(btn => {
                btn.addEventListener('click', () => {
                    const site = normalizeHostname(btn.getAttribute('data-site') || '');
                    if (!site) return;
                    selectionBubbleBlacklist = selectionBubbleBlacklist.filter(entry => entry !== site);
                    persistBubbleBlacklist();
                    renderBubbleBlacklist();
                    scheduleSelectionBubbleUpdate(0);
                });
            });
        }

        function getSelectionBubbleUiLabels() {
            const bubbleLabels = (langNames && langNames.bubble) || (languageNames.en && languageNames.en.bubble) || {};
            return {
                hideOn: bubbleLabels.hideOn || 'Hide on',
                hideSite: bubbleLabels.hideSite || 'Hide on this site',
                hideGlobal: bubbleLabels.hideGlobal || 'Hide globally',
                closeTitle: bubbleLabels.closeTitle || 'Hide selection bubble',
                translateTitle: bubbleLabels.translateTitle || 'Translate selected text'
            };
        }

        function setButtonTitleAndAria(buttonEl, label) {
            if (!buttonEl) return;
            buttonEl.title = label;
            buttonEl.setAttribute('aria-label', label);
        }

        function syncSelectionBubbleSettingsUi() {
            const labels = getSelectionBubbleUiLabels();
            if (selectionBubbleEnabledCheckbox) {
                selectionBubbleEnabledCheckbox.checked = !!selectionBubbleEnabled;
            }
            setButtonTitleAndAria(selectionBubbleClose, labels.closeTitle);
            setButtonTitleAndAria(selectionBubbleAction, labels.translateTitle);
            if (bubbleHideSiteButton) {
                bubbleHideSiteButton.textContent = currentSiteHost ? `${labels.hideOn} ${currentSiteHost}` : labels.hideSite;
            }
            if (bubbleHideGlobalButton) {
                bubbleHideGlobalButton.textContent = labels.hideGlobal;
            }
            renderBubbleBlacklist();
        }

        function getSelectedText() {
            return window.getSelection().toString().trim();
        }

        function ensureSelectValue(selectEl, lang) {
            if (selectEl.querySelector(`option[value="${lang}"]`)) {
                selectEl.value = lang;
                return lang;
            }
            selectEl.value = defaultTargetLang;
            return defaultTargetLang;
        }

        function getSavedTargetLanguage() {
            const saved = GM_getValue('defaultTranslateLang', defaultTargetLang);
            if (!targetLangSelect.querySelector(`option[value="${saved}"]`)) {
                GM_setValue('defaultTranslateLang', defaultTargetLang);
                return defaultTargetLang;
            }
            return saved;
        }

        function persistDefaultTargetLanguage(lang) {
            const valueToPersist = defaultTranslateLangSelect.querySelector(`option[value="${lang}"]`)
                ? lang
                : defaultTargetLang;
            GM_setValue('defaultTranslateLang', valueToPersist);
            return valueToPersist;
        }

        function normalizeToolLanguagePreference(preference) {
            return (preference === 'browser' || supportedUiLanguages.includes(preference)) ? preference : 'browser';
        }

        function setLocalizedRuntimeState(normalizedSelection) {
            toolLanguagePreference = normalizedSelection;
            const newUiLang = resolveUiLang(normalizedSelection);
            langNames = languageNames[newUiLang];
            errors = langNames.errors;
            tooltips = langNames.tooltips;
            dragHandleLabel = langNames.dragHandleLabel || languageNames.en.dragHandleLabel;
            overlayLabels = langNames.overlay || languageNames.en.overlay;
            settingsTitle = langNames.settingsTitle || languageNames.en.settingsTitle;
            settingsDefaultLabel = langNames.settingsDefaultLabel || languageNames.en.settingsDefaultLabel;
            settingsToolLabel = langNames.settingsToolLabel || languageNames.en.settingsToolLabel;
        }

        function getCurrentSettingsLabels() {
            return {
                theme: langNames.settingsThemeLabel || languageNames.en.settingsThemeLabel || 'Theme:',
                bubble: langNames.settingsBubbleLabel || languageNames.en.settingsBubbleLabel || 'Selection Bubble',
                blacklist: langNames.settingsBlacklistLabel || languageNames.en.settingsBlacklistLabel || 'Blacklist',
                blacklistAdd: langNames.settingsBlacklistAdd || languageNames.en.settingsBlacklistAdd || 'Add'
            };
        }

        function updateSettingsTexts() {
            const labels = getCurrentSettingsLabels();
            if (settingsHeaderTitle) settingsHeaderTitle.textContent = settingsTitle;
            if (defaultTranslateLangLabel) defaultTranslateLangLabel.textContent = settingsDefaultLabel;
            if (toolLanguageLabel) toolLanguageLabel.textContent = settingsToolLabel;
            if (panelThemeLabel) panelThemeLabel.textContent = labels.theme;
            if (bubbleToggleLabel) bubbleToggleLabel.textContent = labels.bubble;
            if (bubbleBlacklistLabel) bubbleBlacklistLabel.textContent = labels.blacklist;
            if (bubbleBlacklistAddButton) bubbleBlacklistAddButton.textContent = labels.blacklistAdd;
            if (settingsButton) settingsButton.title = settingsTitle;
        }

        function updateTranslatorTexts() {
            if (sourceAutoOption) sourceAutoOption.textContent = langNames.auto;
            if (speakTranslated) speakTranslated.textContent = tooltips.listenTranslated;
            if (speakOriginal) speakOriginal.textContent = tooltips.listenOriginal;
            const dragHandleEl = translationBox.querySelector('#dragHandle');
            if (dragHandleEl) dragHandleEl.title = dragHandleLabel;
        }

        function updateFullscreenTexts() {
            const fullscreenTitleWrapEl = fullscreenOverlay.querySelector('#fullscreenTitleWrap');
            if (fullscreenTitleWrapEl) fullscreenTitleWrapEl.title = overlayLabels.title;
            if (fullscreenSourceLabel) fullscreenSourceLabel.textContent = overlayLabels.source;
            if (fullscreenTargetLabel) fullscreenTargetLabel.textContent = overlayLabels.target;
            if (fullscreenToggle) fullscreenToggle.title = overlayLabels.open;
            if (fullscreenSourceLangSearch) fullscreenSourceLangSearch.placeholder = langNames.navigator;
            if (fullscreenTargetLangSearch) fullscreenTargetLangSearch.placeholder = langNames.navigator;
            syncLoadingTitles();
        }

        function refreshFullscreenLanguageSelects() {
            if (fullscreenSourceLangSelect) {
                const prev = fullscreenSourceLangSelect.value || 'auto';
                sourceLanguageOptionsHtml = buildSourceLanguageOptionsHtml();
                fullscreenSourceLangSelect.innerHTML = sourceLanguageOptionsHtml;
                fullscreenSourceLangSelect.value = fullscreenSourceLangSelect.querySelector(`option[value="${prev}"]`) ? prev : 'auto';
            }
            if (fullscreenTargetLangSelect) {
                const prev = fullscreenTargetLangSelect.value || defaultTargetLang;
                const refreshedTargetOptionsOverlay = buildTargetLanguageOptions(true);
                fullscreenTargetLangSelect.innerHTML = refreshedTargetOptionsOverlay;
                ensureFullscreenTargetLanguageValid(prev);
            }
            updateFullscreenSourceCurrentLabel();
            updateFullscreenTargetCurrentLabel();
        }

        function refreshToolLanguageSelect(normalizedSelection) {
            if (toolLanguageSelect) {
                toolLanguageSelect.innerHTML = buildToolLanguageOptionsHtml();
                toolLanguageSelect.value = normalizedSelection;
            }
        }

        function refreshThemeOptionsLabels() {
            if (panelThemeSelect) {
                const blueOption = panelThemeSelect.querySelector('option[value="blue"]');
                const darkOption = panelThemeSelect.querySelector('option[value="dark"]');
                const lightOption = panelThemeSelect.querySelector('option[value="light"]');
                const localizedThemes = langNames.themes || languageNames.en.themes || {};
                if (blueOption) blueOption.textContent = localizedThemes.blue || 'Blue';
                if (darkOption) darkOption.textContent = localizedThemes.dark || 'Dark';
                if (lightOption) lightOption.textContent = localizedThemes.light || 'Light';
            }
            updateThemePickerCurrentLabel();
            renderThemePickerOptions();
        }

        function refreshInlineLanguagePlaceholders() {
            inlineLanguagePanels.forEach(({ panel }) => {
                const searchEl = panel.querySelector('.inlineLangSearch');
                if (searchEl) searchEl.placeholder = langNames.navigator;
            });
        }

        function updateNoTextErrorMessage(previousErrors) {
            if (translationText && previousErrors && translationText.textContent === previousErrors.noText) {
                translationText.textContent = errors.noText;
            }
        }

        function refreshTargetLanguageSelects() {
            const currentTargetValue = targetLangSelect.value;
            const savedDefaultValue = GM_getValue('defaultTranslateLang', defaultTargetLang);
            const refreshedTargetOptions = buildTargetLanguageOptions(true);
            targetLangSelect.innerHTML = refreshedTargetOptions;
            ensureSelectValue(targetLangSelect, currentTargetValue);

            defaultTranslateLangSelect.innerHTML = refreshedTargetOptions;
            ensureSelectValue(defaultTranslateLangSelect, savedDefaultValue);
        }

        function applyToolLanguage(preference, { persist = false } = {}) {
            const normalizedSelection = normalizeToolLanguagePreference(preference);
            if (persist) GM_setValue('defaultToolLang', normalizedSelection);

            const previousErrors = errors;
            setLocalizedRuntimeState(normalizedSelection);
            updateSettingsTexts();
            updateTranslatorTexts();
            updateFullscreenTexts();
            refreshFullscreenLanguageSelects();
            refreshToolLanguageSelect(normalizedSelection);
            refreshThemeOptionsLabels();
            updateShortcutSettingsUi();
            refreshInlineLanguagePlaceholders();
            updateNoTextErrorMessage(previousErrors);
            syncSelectionBubbleSettingsUi();
            scheduleSelectionBubbleUpdate(0);
            refreshTargetLanguageSelects();
        }

        function initializeSettingsControls() {
            const initialTargetLang = getSavedTargetLanguage();
            ensureSelectValue(targetLangSelect, initialTargetLang);
            ensureSelectValue(defaultTranslateLangSelect, initialTargetLang);
            currentResolvedTargetLang = initialTargetLang === 'navigator' ? browserLang : initialTargetLang;
            if (toolLanguageSelect) { toolLanguageSelect.value = toolLanguagePreference; }

            // Инициализация настроек ИИ — раздельный выбор движка для панели и полей ввода.
            // Мигрируем со старого единого чекбокса "useAi", если новые настройки ещё не заданы.
            const legacyUseAi = GM_getValue('useAi', false);
            const panelTranslateEngineSelect = translationBox.querySelector('#panelTranslateEngine');
            const fieldTranslateEngineSelect = translationBox.querySelector('#fieldTranslateEngine');
            const aiSettingsBlock = translationBox.querySelector('#aiSettingsBlock');
            const openRouterApiKeyInput = translationBox.querySelector('#openRouterApiKey');
            const aiModelSelect = translationBox.querySelector('#aiModelSelect');
            const aiSystemPromptInput = translationBox.querySelector('#aiSystemPrompt');

            function updateAiSettingsVisibility() {
                const anyAi = GM_getValue('panelTranslateEngine', 'google') === 'ai' || GM_getValue('fieldTranslateEngine', 'google') === 'ai';
                if (aiSettingsBlock) aiSettingsBlock.style.display = anyAi ? 'flex' : 'none';
            }
            if (panelTranslateEngineSelect) {
                const savedPanelEngine = GM_getValue('panelTranslateEngine', legacyUseAi ? 'ai' : 'google');
                GM_setValue('panelTranslateEngine', savedPanelEngine);
                panelTranslateEngineSelect.value = savedPanelEngine;
                panelTranslateEngineSelect.addEventListener('change', () => {
                    GM_setValue('panelTranslateEngine', panelTranslateEngineSelect.value);
                    updateAiSettingsVisibility();
                });
            }
            if (fieldTranslateEngineSelect) {
                const savedFieldEngine = GM_getValue('fieldTranslateEngine', legacyUseAi ? 'ai' : 'google');
                GM_setValue('fieldTranslateEngine', savedFieldEngine);
                fieldTranslateEngineSelect.value = savedFieldEngine;
                fieldTranslateEngineSelect.addEventListener('change', () => {
                    GM_setValue('fieldTranslateEngine', fieldTranslateEngineSelect.value);
                    updateAiSettingsVisibility();
                });
            }
            updateAiSettingsVisibility();

            const aiProviderSelect = translationBox.querySelector('#aiProviderSelect');
            const openRouterSettingsBlockEl = translationBox.querySelector('#openRouterSettingsBlock');
            const nvidiaSettingsBlockEl = translationBox.querySelector('#nvidiaSettingsBlock');
            function updateAiProviderVisibility() {
                const provider = GM_getValue('aiProvider', 'openrouter');
                if (openRouterSettingsBlockEl) openRouterSettingsBlockEl.style.display = provider === 'openrouter' ? 'flex' : 'none';
                if (nvidiaSettingsBlockEl) nvidiaSettingsBlockEl.style.display = provider === 'nvidia' ? 'flex' : 'none';
            }
            if (aiProviderSelect) {
                aiProviderSelect.value = GM_getValue('aiProvider', 'openrouter');
                aiProviderSelect.addEventListener('change', () => {
                    GM_setValue('aiProvider', aiProviderSelect.value);
                    updateAiProviderVisibility();
                });
            }
            updateAiProviderVisibility();

            if (openRouterApiKeyInput) {
                openRouterApiKeyInput.value = GM_getValue('openRouterApiKey', '');
                openRouterApiKeyInput.addEventListener('change', () => GM_setValue('openRouterApiKey', openRouterApiKeyInput.value.trim()));
            }
            const nvidiaApiKeyInput = translationBox.querySelector('#nvidiaApiKey');
            const nvidiaModelSelect = translationBox.querySelector('#nvidiaModelSelect');
            const nvidiaCustomModelInput = translationBox.querySelector('#nvidiaCustomModel');
            const nvidiaModelListRefreshButton = translationBox.querySelector('#nvidiaModelListRefresh');
            const nvidiaModelListStatus = translationBox.querySelector('#nvidiaModelListStatus');
            if (nvidiaApiKeyInput) {
                nvidiaApiKeyInput.value = GM_getValue('nvidiaApiKey', '');
                nvidiaApiKeyInput.addEventListener('change', () => GM_setValue('nvidiaApiKey', nvidiaApiKeyInput.value.trim()));
            }
            if (nvidiaModelSelect) {
                refreshNvidiaModelSelectOptions(nvidiaModelSelect);
                nvidiaModelSelect.addEventListener('change', () => GM_setValue('nvidiaModel', nvidiaModelSelect.value));
            }
            if (nvidiaCustomModelInput) {
                nvidiaCustomModelInput.value = GM_getValue('nvidiaCustomModel', '');
                nvidiaCustomModelInput.addEventListener('change', () => GM_setValue('nvidiaCustomModel', nvidiaCustomModelInput.value.trim()));
            }
            if (nvidiaModelListRefreshButton) {
                nvidiaModelListRefreshButton.addEventListener('click', () => {
                    const key = nvidiaApiKeyInput ? nvidiaApiKeyInput.value.trim() : GM_getValue('nvidiaApiKey', '');
                    if (!key) { if (nvidiaModelListStatus) { nvidiaModelListStatus.textContent = 'Сначала укажите API ключ NVIDIA.'; nvidiaModelListStatus.style.color = '#ff9c7c'; } return; }
                    nvidiaModelListRefreshButton.disabled = true;
                    if (nvidiaModelListStatus) { nvidiaModelListStatus.textContent = 'Обновление...'; nvidiaModelListStatus.style.color = 'rgba(255,255,255,0.45)'; }
                    fetchLiveNvidiaModels(key, (list, error) => {
                        nvidiaModelListRefreshButton.disabled = false;
                        if (!nvidiaModelListStatus) return;
                        if (error) { nvidiaModelListStatus.textContent = error; nvidiaModelListStatus.style.color = '#ff9c7c'; return; }
                        refreshNvidiaModelSelectOptions(nvidiaModelSelect);
                        nvidiaModelListStatus.textContent = `Загружено моделей: ${list.length}, ` + new Date().toLocaleString();
                        nvidiaModelListStatus.style.color = '#7cfc9a';
                    });
                });
            }
            if (aiModelSelect) {
                refreshAiModelSelectOptions(aiModelSelect);
                aiModelSelect.addEventListener('change', () => GM_setValue('aiModel', aiModelSelect.value));
            }
            const aiModelListRefreshButton = translationBox.querySelector('#aiModelListRefresh');
            const aiModelListStatus = translationBox.querySelector('#aiModelListStatus');
            function setModelListStatus(text, isError) {
                if (!aiModelListStatus) return;
                aiModelListStatus.textContent = text;
                aiModelListStatus.style.color = isError ? '#ff9c7c' : 'rgba(255,255,255,0.45)';
            }
            const cachedAt = GM_getValue(OPENROUTER_MODELS_CACHE_TIME_KEY, 0);
            if (cachedAt) setModelListStatus('Обновлено: ' + new Date(cachedAt).toLocaleString());
            // Раз в сутки — тихое фоновое обновление списка моделей (не мешает работе,
            // просто освежает <option> и кэш к следующему разу).
            ensureFreeModelsFresh((list, error) => {
                if (!error) {
                    refreshAiModelSelectOptions(aiModelSelect);
                    setModelListStatus('Обновлено: ' + new Date().toLocaleString());
                }
            });
            if (aiModelListRefreshButton) {
                aiModelListRefreshButton.addEventListener('click', () => {
                    aiModelListRefreshButton.disabled = true;
                    setModelListStatus('Обновление...');
                    ensureFreeModelsFresh((list, error) => {
                        aiModelListRefreshButton.disabled = false;
                        if (error) { setModelListStatus(error, true); return; }
                        refreshAiModelSelectOptions(aiModelSelect);
                        setModelListStatus(`Список обновлён (${list.length} моделей), ` + new Date().toLocaleString());
                    }, true);
                });
            }
            if (aiSystemPromptInput) {
                aiSystemPromptInput.value = GM_getValue('aiSystemPrompt', 'You are a professional translator. Translate the following text to {target_lang}. Keep the original formatting, tone, and meaning. Do not add any extra text, explanations, or notes. Output ONLY the translated text.');
                aiSystemPromptInput.addEventListener('change', () => GM_setValue('aiSystemPrompt', aiSystemPromptInput.value));
            }

            const aiModelFallbackToggle = translationBox.querySelector('#aiModelFallbackToggle');
            if (aiModelFallbackToggle) {
                aiModelFallbackToggle.checked = GM_getValue('aiModelFallback', true);
                aiModelFallbackToggle.addEventListener('change', () => GM_setValue('aiModelFallback', aiModelFallbackToggle.checked));
            }

            const pingModelsButton = translationBox.querySelector('#pingModelsButton');
            const pingModelsResults = translationBox.querySelector('#pingModelsResults');

            function pingOpenRouterModel(model, apiKey, callback) {
                const start = performance.now();
                let settled = false;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    callback(result);
                };
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://openrouter.ai/api/v1/chat/completions',
                    timeout: 15000,
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': window.location.href, 'X-Title': 'TransDesk' },
                    data: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: 'Translate "hello" to French. Reply with only the translated word, nothing else.' }],
                        max_tokens: 10,
                        temperature: 0
                    }),
                    onload: function(response) {
                        const ms = Math.round(performance.now() - start);
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.error) finish({ ok: false, ms, error: data.error.message || 'Ошибка API' });
                            else if (data.choices && data.choices[0] && data.choices[0].message) finish({ ok: true, ms });
                            else finish({ ok: false, ms, error: 'Неверный формат ответа' });
                        } catch (e) { finish({ ok: false, ms, error: 'Ошибка парсинга ответа' }); }
                    },
                    onerror: function() { finish({ ok: false, ms: Math.round(performance.now() - start), error: 'Ошибка сети' }); },
                    ontimeout: function() { finish({ ok: false, ms: Math.round(performance.now() - start), error: 'Таймаут (>15с)' }); }
                });
            }

            function pingNvidiaModel(model, apiKey, callback) {
                const start = performance.now();
                let settled = false;
                const finish = (result) => { if (settled) return; settled = true; callback(result); };
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
                    timeout: 15000,
                    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    data: JSON.stringify({
                        model,
                        messages: [{ role: 'user', content: 'Translate "hello" to French. Reply with only the translated word, nothing else.' }],
                        max_tokens: 10,
                        temperature: 0
                    }),
                    onload: function(response) {
                        const ms = Math.round(performance.now() - start);
                        try {
                            const data = JSON.parse(response.responseText);
                            if (data.choices && data.choices[0] && data.choices[0].message) finish({ ok: true, ms });
                            else if (data.error) finish({ ok: false, ms, error: data.error.message || data.error.detail || 'Ошибка API' });
                            else finish({ ok: false, ms, error: 'Неверный формат ответа' });
                        } catch (e) { finish({ ok: false, ms, error: 'Ошибка парсинга ответа' }); }
                    },
                    onerror: function() { finish({ ok: false, ms: Math.round(performance.now() - start), error: 'Ошибка сети' }); },
                    ontimeout: function() { finish({ ok: false, ms: Math.round(performance.now() - start), error: 'Таймаут (>15с)' }); }
                });
            }

            function runModelPingTest() {
                const provider = GM_getValue('aiProvider', 'openrouter');
                const apiKey = provider === 'nvidia' ? GM_getValue('nvidiaApiKey', '') : GM_getValue('openRouterApiKey', '');
                if (!pingModelsResults || !pingModelsButton) return;
                pingModelsResults.style.display = 'flex';
                if (!apiKey) {
                    pingModelsResults.innerHTML = `<div style="color:#ff9c7c;">Сначала укажите API ключ ${provider === 'nvidia' ? 'NVIDIA' : 'OpenRouter'} выше.</div>`;
                    return;
                }
                pingModelsButton.disabled = true;
                pingModelsButton.textContent = 'Проверка...';
                pingModelsResults.innerHTML = '';
                const PING_MODEL_LIST = provider === 'nvidia' ? getNvidiaModelIds() : getFreeModelIds();
                const pingFn = provider === 'nvidia' ? pingNvidiaModel : pingOpenRouterModel;
                const statusEls = {};
                PING_MODEL_LIST.forEach(model => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; padding:4px 6px; border-radius:6px; background:rgba(255,255,255,0.05);';
                    const nameEl = document.createElement('span');
                    nameEl.style.cssText = 'opacity:0.8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
                    nameEl.textContent = model;
                    const statusEl = document.createElement('span');
                    statusEl.style.cssText = 'flex-shrink:0; font-weight:600;';
                    statusEl.textContent = '…';
                    row.appendChild(nameEl);
                    row.appendChild(statusEl);
                    pingModelsResults.appendChild(row);
                    statusEls[model] = statusEl;
                });

                let index = 0;
                function next() {
                    if (index >= PING_MODEL_LIST.length) {
                        pingModelsButton.disabled = false;
                        pingModelsButton.textContent = 'Проверить скорость моделей';
                        return;
                    }
                    const model = PING_MODEL_LIST[index++];
                    pingFn(model, apiKey, (result) => {
                        const statusEl = statusEls[model];
                        if (statusEl) {
                            if (result.ok) {
                                statusEl.style.color = result.ms < 2000 ? '#7cfc9a' : (result.ms < 5000 ? '#ffd27c' : '#ff9c7c');
                                statusEl.textContent = `${result.ms} мс`;
                            } else {
                                statusEl.style.color = '#ff8080';
                                statusEl.textContent = result.error || 'Ошибка';
                                statusEl.title = result.error || '';
                            }
                        }
                        next();
                    });
                }
                next();
            }

            if (pingModelsButton) pingModelsButton.addEventListener('click', runModelPingTest);

            const replySuggestionToggle = translationBox.querySelector('#replySuggestionToggle');
            const replySuggestionSourceSelect = translationBox.querySelector('#replySuggestionSource');
            const replySuggestionPoolUrlInput = translationBox.querySelector('#replySuggestionPoolUrl');
            const replySuggestionPoolRefreshButton = translationBox.querySelector('#replySuggestionPoolRefresh');
            const replySuggestionPoolStatus = translationBox.querySelector('#replySuggestionPoolStatus');
            const replySuggestionVariantModeSelect = translationBox.querySelector('#replySuggestionVariantMode');
            const replySuggestionLangSelectEl = translationBox.querySelector('#replySuggestionLangSelect');
            const replySuggestionPromptInput = translationBox.querySelector('#replySuggestionPrompt');

            if (replySuggestionToggle) {
                replySuggestionToggle.checked = GM_getValue('replySuggestionEnabled', false);
                replySuggestionToggle.addEventListener('change', () => {
                    GM_setValue('replySuggestionEnabled', replySuggestionToggle.checked);
                    const wrap = translationBox.querySelector('#replySuggestionWrap');
                    if (wrap && !replySuggestionToggle.checked) wrap.style.display = 'none';
                });
            }
            if (replySuggestionSourceSelect) {
                replySuggestionSourceSelect.value = GM_getValue('replySuggestionSource', 'pool_ai');
                replySuggestionSourceSelect.addEventListener('change', () => GM_setValue('replySuggestionSource', replySuggestionSourceSelect.value));
            }
            if (replySuggestionPoolUrlInput) {
                replySuggestionPoolUrlInput.value = GM_getValue('replySuggestionPoolUrl', '');
                replySuggestionPoolUrlInput.addEventListener('change', () => GM_setValue('replySuggestionPoolUrl', replySuggestionPoolUrlInput.value.trim()));
            }
            if (replySuggestionVariantModeSelect) {
                replySuggestionVariantModeSelect.value = GM_getValue('replySuggestionVariantMode', 'random');
                replySuggestionVariantModeSelect.addEventListener('change', () => GM_setValue('replySuggestionVariantMode', replySuggestionVariantModeSelect.value));
            }
            if (replySuggestionLangSelectEl) {
                ensureSelectValue(replySuggestionLangSelectEl, GM_getValue('replySuggestionLang', defaultTargetLang));
                replySuggestionLangSelectEl.addEventListener('change', () => GM_setValue('replySuggestionLang', replySuggestionLangSelectEl.value));
            }
            if (replySuggestionPromptInput) {
                replySuggestionPromptInput.value = GM_getValue('replySuggestionPrompt', DEFAULT_REPLY_SUGGESTION_PROMPT);
                replySuggestionPromptInput.addEventListener('change', () => GM_setValue('replySuggestionPrompt', replySuggestionPromptInput.value));
            }
            if (replySuggestionPoolRefreshButton) {
                replySuggestionPoolRefreshButton.addEventListener('click', () => {
                    const url = (replySuggestionPoolUrlInput ? replySuggestionPoolUrlInput.value : '').trim();
                    if (!url) { if (replySuggestionPoolStatus) replySuggestionPoolStatus.textContent = 'Сначала укажите Raw-URL.'; return; }
                    GM_setValue('replySuggestionPoolUrl', url);
                    replySuggestionPoolRefreshButton.disabled = true;
                    replySuggestionPoolRefreshButton.textContent = 'Загрузка...';
                    if (replySuggestionPoolStatus) replySuggestionPoolStatus.textContent = '';
                    fetchReplyPool(url, (pool, error) => {
                        replySuggestionPoolRefreshButton.disabled = false;
                        replySuggestionPoolRefreshButton.textContent = 'Обновить базу из GitHub';
                        if (replySuggestionPoolStatus) {
                            replySuggestionPoolStatus.textContent = error ? error : `Загружено записей: ${pool.length}`;
                            replySuggestionPoolStatus.style.color = error ? '#ff9c7c' : '#7cfc9a';
                        }
                    });
                });
            }

        if (defaultSourceLangSelect) {
            ensureSelectValue(defaultSourceLangSelect, GM_getValue('defaultSourceLang', 'auto'));
            defaultSourceLangSelect.addEventListener('change', () => {
                GM_setValue('defaultSourceLang', defaultSourceLangSelect.value);
            });
        }

        defaultTranslateLangSelect.addEventListener('change', () => {
            stopSpeaking();
            const persisted = persistDefaultTargetLanguage(defaultTranslateLangSelect.value);
            ensureSelectValue(targetLangSelect, persisted);
            currentResolvedTargetLang = persisted === 'navigator' ? browserLang : persisted;
            handleLanguageChange();
        });

        [defaultTranslateLangLabel, toolLanguageLabel].forEach((labelEl) => {
            if (!labelEl) return;
            labelEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
            labelEl.addEventListener('click', (e) => {
                e.preventDefault();
            });
        });

        if (toolLanguageSelect) {
            toolLanguageSelect.addEventListener('change', () => {
                const selected = toolLanguageSelect.value || 'browser';
                const normalizedSelection = (selected === 'browser' || supportedUiLanguages.includes(selected)) ? selected : 'browser';
                applyToolLanguage(normalizedSelection, { persist: true });
            });
        }

        if (panelThemeSelect) {
            panelThemeSelect.addEventListener('change', () => {
                applyPanelTheme(panelThemeSelect.value || 'blue', { persist: true });
            });
        }

        if (panelThemeTrigger) {
            panelThemeTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isOpen = panelThemePanel && panelThemePanel.style.display === 'block';
                hideInlinePanels();
                hideLanguagePanels();
                if (!panelThemePanel) return;
                if (isOpen) {
                    panelThemePanel.style.display = 'none';
                    return;
                }
                renderThemePickerOptions();
                panelThemePanel.style.display = 'block';
                positionThemePanel();
            });
        }

        function bindShortcutControls() {
        if (shortcutCaptureButton) {
            shortcutCaptureButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                shortcutCaptureActive = true;
                refreshKeyboardLayoutMap();
                updateShortcutSettingsUi();
                shortcutCaptureButton.focus();
            });

            shortcutCaptureButton.addEventListener('keydown', (e) => {
                if (!shortcutCaptureActive) return;
                e.preventDefault();
                e.stopPropagation();

                if (e.key === 'Escape' && !hasShortcutModifier({
                    ctrl: e.ctrlKey,
                    alt: e.altKey,
                    shift: e.shiftKey,
                    meta: e.metaKey
                })) {
                    shortcutCaptureActive = false;
                    updateShortcutSettingsUi();
                    return;
                }

                const candidate = shortcutFromKeyboardEvent(e);
                const labels = getShortcutLabels();
                if (!candidate || !hasShortcutModifier(candidate)) {
                    updateShortcutSettingsUi(labels.invalid);
                    return;
                }

                shortcutCaptureActive = false;
                saveShortcutSetting(candidate);
                updateShortcutSettingsUi(labels.saved);
            });

            shortcutCaptureButton.addEventListener('blur', () => {
                if (!shortcutCaptureActive) return;
                shortcutCaptureActive = false;
                updateShortcutSettingsUi();
            });
        }

        if (shortcutResetButton) {
            shortcutResetButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                shortcutCaptureActive = false;
                saveShortcutSetting(cloneDefaultShortcut());
            });
        }
        }

        bindShortcutControls();

        function bindSelectionBubbleControls() {
        if (selectionBubbleEnabledCheckbox) {
            selectionBubbleEnabledCheckbox.addEventListener('change', () => {
                selectionBubbleEnabled = !!selectionBubbleEnabledCheckbox.checked;
                persistSelectionBubbleEnabled();
                hideSelectionBubble();
                scheduleSelectionBubbleUpdate(0);
            });
        }

        if (bubbleBlacklistAddButton) {
            const addBlacklistSite = () => {
                const normalized = normalizeHostname(bubbleBlacklistInput ? bubbleBlacklistInput.value : '');
                if (!normalized) return;
                if (!selectionBubbleBlacklist.includes(normalized)) {
                    selectionBubbleBlacklist.push(normalized);
                    selectionBubbleBlacklist.sort((a, b) => a.localeCompare(b));
                    persistBubbleBlacklist();
                    renderBubbleBlacklist();
                }
                if (bubbleBlacklistInput) bubbleBlacklistInput.value = '';
                hideSelectionBubble();
                scheduleSelectionBubbleUpdate(0);
            };

            bubbleBlacklistAddButton.addEventListener('click', addBlacklistSite);
            if (bubbleBlacklistInput) {
                bubbleBlacklistInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        addBlacklistSite();
                    }
                });
            }
        }

        selectionBubble.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });

        document.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (eventPathContains(e, selectionBubble) || eventPathContains(e, translationBox) || eventPathContains(e, fullscreenOverlay)) return;
            isSelectingPointer = true;
            hideSelectionBubble();
        }, true);

        if (selectionBubbleClose) {
            selectionBubbleClose.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!bubbleCloseMenu) return;
                const isOpen = bubbleCloseMenu.classList.contains('utst-open');
                bubbleCloseMenu.classList.toggle('utst-open', !isOpen);
            });
        }

        if (bubbleHideSiteButton) {
            bubbleHideSiteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentSiteHost && !selectionBubbleBlacklist.includes(currentSiteHost)) {
                    selectionBubbleBlacklist.push(currentSiteHost);
                    selectionBubbleBlacklist.sort((a, b) => a.localeCompare(b));
                    persistBubbleBlacklist();
                }
                hideSelectionBubble();
                syncSelectionBubbleSettingsUi();
                scheduleSelectionBubbleUpdate(0);
            });
        }

        if (bubbleHideGlobalButton) {
            bubbleHideGlobalButton.addEventListener('click', (e) => {
                e.stopPropagation();
                selectionBubbleEnabled = false;
                persistSelectionBubbleEnabled();
                syncSelectionBubbleSettingsUi();
                hideSelectionBubble();
            });
        }

        if (selectionBubbleAction) {
            selectionBubbleAction.addEventListener('click', (e) => {
                e.stopPropagation();
                const text = (bubbleSelectedText || getSelectedText() || '').trim();
                const pos = bubbleSelectionPosition
                    ? { x: bubbleSelectionPosition.x, y: bubbleSelectionPosition.y }
                    : null;
                openTranslationPanelForText(text, pos);
            });
        }
        }

        bindSelectionBubbleControls();

            applyPanelTheme(currentPanelTheme);
            applyToolLanguage(toolLanguagePreference);
            syncSelectionBubbleSettingsUi();
            refreshKeyboardLayoutMap();
            scheduleSelectionBubbleUpdate(0);
        }

        initializeSettingsControls();



        function splitLineIntoSentencesPreservingSpacing(line) {
            if (!line) return [];
            const segments = [];
            const sentenceEndChars = '.!?。！？';
            let start = 0;

            for (let i = 0; i < line.length; i++) {
                if (!sentenceEndChars.includes(line[i])) continue;

                let end = i + 1;
                while (end < line.length && (line[end] === ' ' || line[end] === '\t')) {
                    end++;
                }
                segments.push(line.slice(start, end));
                start = end;
            }

            if (start < line.length) {
                segments.push(line.slice(start));
            }

            return segments.length ? segments : [line];
        }

        function splitSentences(text) {
            if (!text) return [text];
            const segments = [];
            const lineBreakRegex = /(\r\n|\r|\n)/g;
            let lastIndex = 0;
            let match;

            while ((match = lineBreakRegex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    segments.push(...splitLineIntoSentencesPreservingSpacing(text.slice(lastIndex, match.index)));
                }
                segments.push(match[0]);
                lastIndex = match.index + match[0].length;
            }

            if (lastIndex < text.length) {
                segments.push(...splitLineIntoSentencesPreservingSpacing(text.slice(lastIndex)));
            }

            return segments.length ? segments : [text];
        }

        function splitOversizedSegment(segment, maxLength) {
            if (!segment || segment.length <= maxLength) return [segment];
            const chunks = [];
            let start = 0;

            while (start < segment.length) {
                let end = Math.min(start + maxLength, segment.length);
                if (end < segment.length) {
                    const spaceIndex = segment.lastIndexOf(' ', end);
                    const tabIndex = segment.lastIndexOf('\t', end);
                    const breakIndex = Math.max(spaceIndex, tabIndex);
                    if (breakIndex > start + Math.floor(maxLength * 0.55)) {
                        end = breakIndex + 1;
                    }
                }
                chunks.push(segment.slice(start, end));
                start = end;
            }

            return chunks;
        }

        function buildTranslationChunks(text, maxLength = 1800) {
            const segments = splitSentences(text).flatMap(segment => splitOversizedSegment(segment, maxLength));
            const chunks = [];
            let current = '';

            segments.forEach(segment => {
                if (!segment) return;
                if (current && current.length + segment.length > maxLength) {
                    chunks.push(current);
                    current = '';
                }
                current += segment;
            });

            if (current) {
                chunks.push(current);
            }

            return chunks.length ? chunks : [text];
        }


        function translateSentence(text, sourceLang, targetLang, callback, retryLeft = 1) {
            if (!text || !text.trim()) {
                callback(text, null);
                return;
            }

            const leadingWhitespace = text.match(/^\s*/)[0];
            const trailingWhitespace = text.match(/\s*$/)[0];
            const textToTranslate = text.slice(leadingWhitespace.length, text.length - trailingWhitespace.length);

            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`,
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);

                        let detected = sourceLang;
                        if (sourceLang === 'auto') {
                            if (data[2]) {
                                detected = data[2];
                            } else if (data[8] && data[8][0] && data[8][0][0]) {
                                detected = data[8][0][0];
                            } else {
                                detected = '';
                            }
                        }

                        const translation = (data && data[0])
                            ? data[0].map(part => part && part[0] ? part[0] : '').join('')
                            : '';

                        callback(`${leadingWhitespace}${translation}${trailingWhitespace}`, detected || null);
                    } catch (e) {
                        if (retryLeft > 0) { translateSentence(text, sourceLang, targetLang, callback, retryLeft - 1); return; }
                        callback(`${leadingWhitespace}${errors.translation}${trailingWhitespace}`, null);
                    }
                },
                onerror: function () {
                    if (retryLeft > 0) { setTimeout(() => translateSentence(text, sourceLang, targetLang, callback, retryLeft - 1), 400); return; }
                    callback(`${leadingWhitespace}${errors.connection}${trailingWhitespace}`, null);
                }
            });
        }


        function requestOpenRouterCompletion(model, apiKey, prompt, text, callback) {
            GM_xmlhttpRequest({
                method: 'POST', url: 'https://openrouter.ai/api/v1/chat/completions',
                timeout: 20000,
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': window.location.href, 'X-Title': 'TransDesk' },
                data: JSON.stringify({ model: model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }], temperature: 0.3 }),
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.error) callback({ ok: false, error: data.error.message || 'Ошибка ИИ' });
                        else if (data.choices && data.choices[0] && data.choices[0].message) callback({ ok: true, text: data.choices[0].message.content.trim() });
                        else callback({ ok: false, error: 'Неверный формат ответа ИИ' });
                    } catch (e) { callback({ ok: false, error: 'Ошибка парсинга ответа ИИ: ' + e.message }); }
                },
                onerror: function() { callback({ ok: false, error: 'Ошибка соединения с OpenRouter' }); },
                ontimeout: function() { callback({ ok: false, error: 'Таймаут ответа от OpenRouter' }); }
            });
        }

        // Общий фолбэк-раннер: бьёт по выбранной модели, при ошибке — по остальным
        // моделям того же провайдера, независимо от того, вызывается ли это для
        // перевода текста или для генерации подсказки ответа.
        function runAiCompletionWithFallback(prompt, userText, callback) {
            const provider = GM_getValue('aiProvider', 'openrouter');
            const fallbackEnabled = GM_getValue('aiModelFallback', true);

            if (provider === 'nvidia') {
                const apiKey = GM_getValue('nvidiaApiKey', '');
                if (!apiKey) { callback(null, 'Отсутствует API ключ NVIDIA в настройках.'); return; }
                const customModel = (GM_getValue('nvidiaCustomModel', '') || '').trim();
                const preferredModel = customModel || GM_getValue('nvidiaModel', NVIDIA_MODEL_PRESETS[0].id);
                const modelQueue = (fallbackEnabled && !customModel)
                    ? [preferredModel, ...getNvidiaModelIds().filter(m => m !== preferredModel)]
                    : [preferredModel];
                let index = 0, lastError = 'Ошибка ИИ';
                (function tryNext() {
                    if (index >= modelQueue.length) { callback(null, lastError); return; }
                    const model = modelQueue[index++];
                    requestNvidiaCompletion(model, apiKey, prompt, userText, (result) => {
                        if (result.ok) callback(result.text, null);
                        else { lastError = result.error; tryNext(); }
                    });
                })();
                return;
            }

            const apiKey = GM_getValue('openRouterApiKey', '');
            if (!apiKey) { callback(null, 'Отсутствует API ключ OpenRouter в настройках.'); return; }
            const preferredModel = GM_getValue('aiModel', 'google/gemma-4-31b-it:free');
            const modelQueue = fallbackEnabled
                ? [preferredModel, ...getFreeModelIds().filter(m => m !== preferredModel)]
                : [preferredModel];
            let index = 0, lastError = 'Ошибка ИИ';
            (function tryNext() {
                if (index >= modelQueue.length) { callback(null, lastError); return; }
                const model = modelQueue[index++];
                requestOpenRouterCompletion(model, apiKey, prompt, userText, (result) => {
                    if (result.ok) callback(result.text, null);
                    else { lastError = result.error; tryNext(); }
                });
            })();
        }

        function translateWithAi(text, targetLang, callback) {
            let prompt = GM_getValue('aiSystemPrompt', 'You are a professional translator. Translate the following text to {target_lang}. Keep the original formatting, tone, and meaning. Do not add any extra text, explanations, or notes. Output ONLY the translated text.');
            const targetLangName = getLanguageLabel(targetLang) || targetLang;
            prompt = prompt.replace(/{target_lang}/gi, targetLangName);
            runAiCompletionWithFallback(prompt, text, (result, error) => {
                callback(result || ('Ошибка: ' + (error || 'не удалось получить перевод от ИИ.')), null);
            });
        }

        // ===== Подсказки ответов лиду: ИИ / база с GitHub (raw JSON) / комбинация =====
        let replyPoolCache = null;
        let replyPoolCacheUrl = null;

        function fetchReplyPool(url, callback) {
            if (!url) { callback([], 'URL базы не указан в настройках.'); return; }
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: 15000,
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (!Array.isArray(data)) { callback([], 'Файл должен быть JSON-массивом.'); return; }
                        const normalized = data
                            .map(item => {
                                if (!item) return null;
                                // Поддерживаем и одиночный "reply": "...", и массив "replies": ["...", "..."]
                                let replies = [];
                                if (Array.isArray(item.replies)) replies = item.replies.filter(r => typeof r === 'string' && r.trim());
                                else if (typeof item.reply === 'string' && item.reply.trim()) replies = [item.reply];
                                if (!replies.length) return null;
                                return {
                                    keywords: Array.isArray(item.keywords) ? item.keywords.map(k => String(k).toLowerCase()) : [],
                                    replies
                                };
                            })
                            .filter(Boolean);
                        replyPoolCache = normalized;
                        replyPoolCacheUrl = url;
                        GM_setValue('replySuggestionPoolCache', normalized);
                        GM_setValue('replySuggestionPoolCacheUrl', url);
                        callback(normalized, null);
                    } catch (e) { callback([], 'Ошибка парсинга JSON: ' + e.message); }
                },
                onerror: function () { callback([], 'Ошибка сети при загрузке базы.'); },
                ontimeout: function () { callback([], 'Таймаут при загрузке базы.'); }
            });
        }

        function getReplyPool(url, callback) {
            if (replyPoolCache && replyPoolCacheUrl === url) { callback(replyPoolCache, null); return; }
            const savedUrl = GM_getValue('replySuggestionPoolCacheUrl', '');
            const savedCache = GM_getValue('replySuggestionPoolCache', null);
            // Кэш мог остаться от старого формата (одиночное поле "reply") — на всякий
            // случай проверяем форму первой записи, иначе просто перезапрашиваем файл.
            const cacheShapeOk = Array.isArray(savedCache) && (savedCache.length === 0 || Array.isArray(savedCache[0].replies));
            if (savedCache && savedUrl === url && cacheShapeOk) {
                replyPoolCache = savedCache;
                replyPoolCacheUrl = url;
                callback(savedCache, null);
                return;
            }
            fetchReplyPool(url, callback);
        }


        function matchReplyFromPool(pool, sourceText) {
            if (!pool || !pool.length || !sourceText) return null;
            const lowerText = sourceText.toLowerCase();
            let best = null;
            let bestScore = 0;
            pool.forEach(entry => {
                let score = 0;
                entry.keywords.forEach(kw => { if (kw && lowerText.indexOf(kw) !== -1) score++; });
                if (score > bestScore) { bestScore = score; best = entry; }
            });
            return bestScore > 0 ? best : null;
        }

        function generateAiReplySuggestion(sourceText, targetLangCode, templateHint, callback) {
            let prompt = GM_getValue('replySuggestionPrompt', DEFAULT_REPLY_SUGGESTION_PROMPT);
            const targetLangName = getLanguageLabel(targetLangCode) || targetLangCode;
            prompt = prompt.replace(/{target_lang}/gi, targetLangName).replace(/{template}/gi, templateHint || '(нет)');
            runAiCompletionWithFallback(prompt, sourceText, callback);
        }

        function pickRandomVariant(entry) {
            if (!entry || !entry.replies || !entry.replies.length) return null;
            if (entry.replies.length === 1) return entry.replies[0];
            return entry.replies[Math.floor(Math.random() * entry.replies.length)];
        }

        let lastReplySuggestionSourceText = '';
        function generateReplySuggestion(sourceText) {
            if (!GM_getValue('replySuggestionEnabled', false)) return;
            if (!sourceText || !sourceText.trim()) return;
            const wrap = translationBox.querySelector('#replySuggestionWrap');
            const textEl = translationBox.querySelector('#replySuggestionText');
            const badgeEl = translationBox.querySelector('#replySuggestionBadge');
            if (!wrap || !textEl) return;

            lastReplySuggestionSourceText = sourceText;
            wrap.style.display = 'block';
            textEl.textContent = 'Генерация подсказки...';
            if (badgeEl) badgeEl.style.display = 'none';

            const mode = GM_getValue('replySuggestionSource', 'pool_ai');
            const variantMode = GM_getValue('replySuggestionVariantMode', 'random');
            const langCode = GM_getValue('replySuggestionLang', defaultTargetLang);
            const poolUrl = (GM_getValue('replySuggestionPoolUrl', '') || '').trim();

            function setBadge(label) {
                if (!badgeEl) return;
                if (!label) { badgeEl.style.display = 'none'; return; }
                badgeEl.textContent = label;
                badgeEl.style.display = 'inline-block';
            }
            function finish(text, badgeLabel) { textEl.textContent = text; setBadge(badgeLabel); }
            function useAi(templateHint) {
                generateAiReplySuggestion(sourceText, langCode, templateHint, (text, error) => {
                    if (!text) { finish('Ошибка: ' + (error || 'не удалось сгенерировать подсказку.'), null); return; }
                    finish(text, templateHint ? 'База+ИИ' : 'ИИ');
                });
            }
            // Если в найденной теме несколько готовых вариантов — либо берём случайный,
            // либо (только в режиме "База + ИИ") отдаём ИИ все варианты, чтобы он выбрал
            // наиболее подходящий по смыслу и доработал именно его под это сообщение.
            function useAiWithVariants(entry) {
                if (!entry) { useAi(''); return; }
                if (variantMode === 'ai_pick' && entry.replies.length > 1) {
                    const templateHint = 'Ниже несколько готовых вариантов ответа на похожие сообщения — выбери ОДИН, наиболее подходящий по смыслу к этому конкретному сообщению, и адаптируй его под него:\n\n'
                        + entry.replies.map((r, i) => `Вариант ${i + 1}: ${r}`).join('\n\n');
                    useAi(templateHint);
                } else {
                    useAi(pickRandomVariant(entry) || '');
                }
            }

            if (mode === 'ai') { useAi(''); return; }

            if (!poolUrl) {
                if (mode === 'pool_ai') { useAi(''); return; }
                finish('Укажите Raw-URL базы подсказок в настройках.', null);
                return;
            }

            getReplyPool(poolUrl, (pool, error) => {
                if (error) {
                    if (mode === 'pool_ai') { useAi(''); return; }
                    finish('Ошибка базы: ' + error, null);
                    return;
                }
                const match = matchReplyFromPool(pool, sourceText);
                if (mode === 'pool') {
                    // Чистый режим "База" — без ИИ, всегда случайный вариант из подходящей темы.
                    const picked = match ? pickRandomVariant(match) : null;
                    finish(picked || 'Подходящий шаблон не найден в базе.', picked ? 'База' : null);
                    return;
                }
                useAiWithVariants(match);
            });
        }



        function stripSpanishInvertedMarks(text, langCode) {
            if (!text || !langCode) return text;
            if (!/^es/i.test(langCode)) return text;
            return text.replace(/[¡¿]/g, '');
        }

        // Кэш переводов на текущую сессию страницы — повторный перевод того же
        // текста в тот же язык тем же движком отдаётся мгновенно, без запроса.
        const translationCache = new Map();
        const TRANSLATION_CACHE_LIMIT = 200;
        function translationCacheKey(text, targetLang, engineKey) {
            return `${engineKey}|${targetLang}|${text}`;
        }
        function translationCacheGet(key) { return translationCache.get(key); }
        function translationCacheSet(key, value) {
            if (!value || value.indexOf('Ошибка') === 0) return;
            if (translationCache.size >= TRANSLATION_CACHE_LIMIT) {
                translationCache.delete(translationCache.keys().next().value);
            }
            translationCache.set(key, value);
        }

        function translateText(text, sourceLang, targetLang, callback, position, engine) {
            if (!text) { callback(errors.noText, position, null); return; }
            if (!sourceLang || sourceLang === '') sourceLang = 'auto';
            let resolvedTargetLang = targetLang;
            if (resolvedTargetLang === 'navigator') resolvedTargetLang = browserLang;
            if (!resolvedTargetLang || resolvedTargetLang === '') {
                let fallback = getSavedTargetLanguage();
                if (fallback === 'navigator') fallback = browserLang;
                resolvedTargetLang = fallback || defaultTargetLang;
            }
            const useAi = engine ? engine === 'ai' : GM_getValue('useAi', false);
            const engineKey = useAi ? ('ai:' + GM_getValue('aiModel', '')) : 'google';
            const cacheKey = translationCacheKey(text, resolvedTargetLang, engineKey);
            const cached = translationCacheGet(cacheKey);
            if (cached !== undefined) { callback(cached, position, resolvedTargetLang); return; }

            if (useAi) {
                translateWithAi(text, resolvedTargetLang, (translation, detected) => {
                    const result = stripSpanishInvertedMarks(translation, resolvedTargetLang);
                    translationCacheSet(cacheKey, result);
                    callback(result, position, resolvedTargetLang);
                });
                return;
            }
            const sentences = buildTranslationChunks(text);
            let translatedSentences = [];
            let completed = 0;
            let activeRequests = 0;
            let nextIndex = 0;
            const maxConcurrentRequests = 3;

            let runDetectedLang = null;

            function finishTranslationIfComplete() {
                if (completed !== sentences.length) return;
                if (runDetectedLang && sourceLangSelect.querySelector(`option[value="${runDetectedLang}"]`)) {
                    sourceLangSelect.value = runDetectedLang;
                    detectedSourceLang = runDetectedLang;
                } else {
                    sourceLangSelect.value = 'auto';
                    detectedSourceLang = 'auto';
                }
                updateFullscreenSourceCurrentLabel();

                const fullTranslation = translatedSentences.join('');
                const result = stripSpanishInvertedMarks(fullTranslation, resolvedTargetLang);
                translationCacheSet(cacheKey, result);
                callback(result, position, resolvedTargetLang);
            }

            function runNextTranslations() {
                while (activeRequests < maxConcurrentRequests && nextIndex < sentences.length) {
                    const index = nextIndex++;
                    const sentence = sentences[index];
                    activeRequests++;

                    translateSentence(sentence, sourceLang, resolvedTargetLang, (translation, detected) => {
                        translatedSentences[index] = translation;
                        activeRequests--;
                        completed++;

                        if (!runDetectedLang && detected && googleTranslateLanguages[detected]) {
                            runDetectedLang = detected;
                        }

                        finishTranslationIfComplete();
                        runNextTranslations();
                    });
                }
            }

            if (!sentences.length) {
                callback('', position, resolvedTargetLang);
                return;
            }

            runNextTranslations();
        }


        let currentSpeakerId = null;
        let speechPlaying = false;
        let activeSpeechAudio = null;
        let activeSpeechAudioUrl = null;
        let speechQueue = [];
        let speechFetchRequest = null;
        let speechRequestToken = 0;
        const SPEECH_ACTIVE_STROKE = COPY_FEEDBACK_STROKE;

        function setSpeakButtonVisualState(buttonEl, active) {
            if (!buttonEl) return;
            setButtonIconStroke(buttonEl, active ? SPEECH_ACTIVE_STROKE : getIconDefaultStrokeColor());
        }

        function updateSpeechIconState() {
            const panelActive = speechPlaying && currentSpeakerId && currentSpeakerId.startsWith('panel-');
            const sourceActive = speechPlaying && currentSpeakerId === 'fs-source';
            const targetActive = speechPlaying && currentSpeakerId === 'fs-target';

            setSpeakButtonVisualState(speakButton, panelActive);
            setSpeakButtonVisualState(fullscreenSourceSpeak, sourceActive);
            setSpeakButtonVisualState(fullscreenTargetSpeak, targetActive);
        }

        speechStateReady = true;
        updateSpeechIconState();

        function normalizeSpeechLangTag(langTag) {
            return (langTag || '').toLowerCase().replace(/_/g, '-').trim();
        }

        function clearActiveSpeechAudio() {
            if (activeSpeechAudio) {
                activeSpeechAudio.onended = null;
                activeSpeechAudio.onerror = null;
                activeSpeechAudio.pause();
                activeSpeechAudio.src = '';
                activeSpeechAudio = null;
            }
            if (activeSpeechAudioUrl) {
                URL.revokeObjectURL(activeSpeechAudioUrl);
                activeSpeechAudioUrl = null;
            }
        }

        function stopSpeaking() {
            speechRequestToken += 1;
            if (speechFetchRequest && typeof speechFetchRequest.abort === 'function') {
                speechFetchRequest.abort();
            }
            speechFetchRequest = null;
            speechQueue = [];
            clearActiveSpeechAudio();
            speechPlaying = false;
            currentSpeakerId = null;
            updateSpeechIconState();
        }

        function normalizeGoogleTtsLang(langCode) {
            let normalized = normalizeSpeechLangTag(langCode);
            if (!normalized || normalized === 'auto' || normalized === 'navigator') {
                normalized = normalizeSpeechLangTag(browserLang || 'en');
            }
            if (normalized === 'zh-cn' || normalized === 'zh-sg') return 'zh-CN';
            if (normalized === 'zh-tw' || normalized === 'zh-hk') return 'zh-TW';
            if (normalized === 'pt-br') return 'pt-BR';
            return normalized;
        }

        function getGoogleTtsLanguageCandidates(langCode) {
            const normalized = normalizeGoogleTtsLang(langCode);
            const candidates = [normalized];
            const base = normalized.split('-')[0];
            if (base && !candidates.includes(base)) candidates.push(base);
            return candidates.filter(Boolean);
        }

        function splitTextForGoogleTts(text, maxChunkLength = 180) {
            const normalized = (text || '').replace(/\s+/g, ' ').trim();
            if (!normalized) return [];
            if (normalized.length <= maxChunkLength) return [normalized];

            const chunks = [];
            const sentences = normalized.match(/[^.!?]+[.!?]*/g) || [normalized];

            sentences.forEach((sentenceRaw) => {
                const sentence = sentenceRaw.trim();
                if (!sentence) return;
                if (sentence.length <= maxChunkLength) {
                    chunks.push(sentence);
                    return;
                }
                const words = sentence.split(' ');
                let current = '';
                words.forEach((word) => {
                    if (!word) return;
                    if (word.length > maxChunkLength) {
                        if (current) {
                            chunks.push(current);
                            current = '';
                        }
                        for (let i = 0; i < word.length; i += maxChunkLength) {
                            chunks.push(word.slice(i, i + maxChunkLength));
                        }
                        return;
                    }
                    const next = current ? `${current} ${word}` : word;
                    if (next.length > maxChunkLength) {
                        if (current) chunks.push(current);
                        current = word;
                    } else {
                        current = next;
                    }
                });
                if (current) chunks.push(current);
            });

            return chunks.filter(Boolean);
        }

        function finishSpeechPlayback(requestToken) {
            if (requestToken !== speechRequestToken) return;
            speechFetchRequest = null;
            speechQueue = [];
            clearActiveSpeechAudio();
            speechPlaying = false;
            currentSpeakerId = null;
            updateSpeechIconState();
        }

        function fetchGoogleTtsChunk(chunkText, langCandidates, requestToken, done) {
            if (!chunkText || !langCandidates.length || requestToken !== speechRequestToken) {
                done(null);
                return;
            }

            const tryCandidate = (index) => {
                if (requestToken !== speechRequestToken) {
                    done(null);
                    return;
                }
                if (index >= langCandidates.length) {
                    done(null);
                    return;
                }

                const candidateLang = langCandidates[index];
                const url = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(candidateLang)}&q=${encodeURIComponent(chunkText)}`;
                speechFetchRequest = GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    responseType: 'arraybuffer',
                    onload: (response) => {
                        speechFetchRequest = null;
                        if (requestToken !== speechRequestToken) {
                            done(null);
                            return;
                        }
                        const status = Number(response.status) || 0;
                        const hasAudio = response.response && response.response.byteLength > 0;
                        if (status >= 200 && status < 300 && hasAudio) {
                            done(new Blob([response.response], { type: 'audio/mpeg' }));
                            return;
                        }
                        tryCandidate(index + 1);
                    },
                    onerror: () => {
                        speechFetchRequest = null;
                        if (requestToken !== speechRequestToken) {
                            done(null);
                            return;
                        }
                        tryCandidate(index + 1);
                    }
                });
            };

            tryCandidate(0);
        }

        function playSpeechChunkAt(index, requestToken, langCandidates) {
            if (requestToken !== speechRequestToken) return;
            if (!speechQueue.length || index >= speechQueue.length) {
                finishSpeechPlayback(requestToken);
                return;
            }

            fetchGoogleTtsChunk(speechQueue[index], langCandidates, requestToken, (audioBlob) => {
                if (requestToken !== speechRequestToken) return;
                if (!audioBlob) {
                    finishSpeechPlayback(requestToken);
                    return;
                }

                clearActiveSpeechAudio();
                activeSpeechAudioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(activeSpeechAudioUrl);
                activeSpeechAudio = audio;
                audio.onended = () => {
                    playSpeechChunkAt(index + 1, requestToken, langCandidates);
                };
                audio.onerror = () => {
                    playSpeechChunkAt(index + 1, requestToken, langCandidates);
                };
                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch(() => {
                        playSpeechChunkAt(index + 1, requestToken, langCandidates);
                    });
                }
            });
        }

        function speak(text, lang, speakerId = null) {
            const value = (text || '').trim();
            if (!value) return;

            const sameSpeaker = speechPlaying && speakerId && speakerId === currentSpeakerId;
            if (sameSpeaker) {
                stopSpeaking();
                return;
            }

            stopSpeaking();

            speechQueue = splitTextForGoogleTts(value);
            if (!speechQueue.length) return;

            const requestToken = speechRequestToken;
            const langCandidates = getGoogleTtsLanguageCandidates(lang);

            currentSpeakerId = speakerId;
            speechPlaying = true;
            updateSpeechIconState();
            playSpeechChunkAt(0, requestToken, langCandidates);
        }

        function openTranslationPanelForText(selectedText, selectionPosition) {
            stopSpeaking();
            const defaultSourceLang = GM_getValue('defaultSourceLang', 'auto');
            sourceLangSelect.value = defaultSourceLang;
            detectedSourceLang = defaultSourceLang;

            if (translatorPanel) translatorPanel.style.display = 'block';
            if (settingsPanel) settingsPanel.style.display = 'none';
            if (settingsHeader) settingsHeader.style.display = 'none';
            translationBox.classList.remove('utst-settings-open');

            hideSelectionBubble();
            hideBubbleCloseMenu();

            const text = (selectedText || '').trim();
            if (!text) {
                const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
                const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
                panelTranslateRequestId++;
                setPanelLoading(false);
                translationText.textContent = errors.noText;
                translationBox.style.display = 'block';
                translationBox.style.left = `${scrollX + window.innerWidth / 2 - 150}px`;
                translationBox.style.top = `${scrollY + window.innerHeight / 2 - 50}px`;
                translationBox.style.opacity = '1';
                translationBox.style.transform = 'translateY(0)';
                return;
            }

            currentSelectedText = text;

            const savedTargetLang = getSavedTargetLanguage();
            const targetLangForSession = ensureSelectValue(targetLangSelect, savedTargetLang);
            ensureSelectValue(defaultTranslateLangSelect, savedTargetLang);

            const fallbackPosition = selectionPosition && Number.isFinite(selectionPosition.x) && Number.isFinite(selectionPosition.y)
                ? selectionPosition
                : { x: 0, y: 0 };

            translationText.textContent = '';
            const replySuggestionWrapEl = translationBox.querySelector('#replySuggestionWrap');
            if (replySuggestionWrapEl) replySuggestionWrapEl.style.display = 'none';
            placeBoxAtSelection(fallbackPosition);
            translationBox.style.display = 'block';
            translationBox.style.opacity = '1';
            translationBox.style.transform = 'translateY(0)';

            runPanelTranslation(text, defaultSourceLang, targetLangForSession, (translation, pos, resolvedTargetLang) => {
                currentTranslatedText = translation;
                translationText.textContent = translation;
                currentResolvedTargetLang = resolvedTargetLang || currentResolvedTargetLang;
                placeBoxAtSelection(pos || fallbackPosition);
                hideSelectionBubble();
                generateReplySuggestion(text);
            }, fallbackPosition, 'translate', GM_getValue('panelTranslateEngine', 'google'));
        }


        function isOwnUiElement(el) {
            return !!(el && (translationBox.contains(el) || fullscreenOverlay.contains(el) || selectionBubble.contains(el)));
        }

        // Обычный document.activeElement не видит фокус, ушедший внутрь
        // одностраничных React/Vue-виджетов с открытым shadow DOM (например,
        // кастомные rich-text редакторы в CRM), а также внутрь iframe того же
        // источника (например, встроенный TinyMCE/CKEditor). Спускаемся вглубь,
        // пока не найдём реально сфокусированный элемент.
        function getDeepActiveElement() {
            let active = document.activeElement;
            let guard = 0;
            while (active && guard++ < 25) {
                if (active.shadowRoot && active.shadowRoot.activeElement) {
                    active = active.shadowRoot.activeElement;
                    continue;
                }
                if (active.tagName === 'IFRAME') {
                    let innerDoc = null;
                    try { innerDoc = active.contentDocument; } catch (e) { break; }
                    if (innerDoc && innerDoc.activeElement && innerDoc.activeElement !== innerDoc.body) {
                        active = innerDoc.activeElement;
                        continue;
                    }
                    break;
                }
                break;
            }
            return active;
        }

        function getEditableFieldContext() {
            const active = getDeepActiveElement();
            if (!active || isOwnUiElement(active)) return null;

            const tag = active.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
                if (tag === 'INPUT' && active.type && !['text', 'search', 'url', 'tel', 'email', ''].includes(active.type)) return null;
                const start = active.selectionStart;
                const end = active.selectionEnd;
                const hasSelection = typeof start === 'number' && typeof end === 'number' && start !== end;
                const text = hasSelection ? active.value.slice(start, end) : active.value;
                if (!text || !text.trim()) return null;
                return { kind: 'field', el: active, hasSelection, start, end, text };
            }

            if (active.isContentEditable) {
                const ownerDoc = active.ownerDocument || document;
                const ownerWin = ownerDoc.defaultView || window;
                const sel = ownerWin.getSelection();
                let hasSelection = false;
                let text = '';
                let range = null;
                if (sel && sel.rangeCount && !sel.isCollapsed && active.contains(sel.anchorNode)) {
                    text = sel.toString();
                    hasSelection = true;
                    range = sel.getRangeAt(0).cloneRange();
                } else {
                    text = active.innerText || active.textContent || '';
                }
                if (!text || !text.trim()) return null;
                return { kind: 'editable', el: active, hasSelection, text, range, win: ownerWin };
            }

            return null;
        }

        function setNativeFieldValue(el, value) {
            const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
            if (descriptor && descriptor.set) {
                descriptor.set.call(el, value);
            } else {
                el.value = value;
            }
        }

        function replaceEditableFieldText(context, translation) {
            const el = context.el;
            if (context.kind === 'field') {
                if (context.hasSelection) {
                    const newValue = el.value.slice(0, context.start) + translation + el.value.slice(context.end);
                    const cursor = context.start + translation.length;
                    setNativeFieldValue(el, newValue);
                    el.setSelectionRange(cursor, cursor);
                } else {
                    setNativeFieldValue(el, translation);
                    el.setSelectionRange(translation.length, translation.length);
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.focus();
            } else if (context.kind === 'editable') {
                el.focus();
                if (context.hasSelection && context.range) {
                    const sel = (context.win || window).getSelection();
                    sel.removeAllRanges();
                    sel.addRange(context.range);
                    document.execCommand('insertText', false, translation);
                } else {
                    el.textContent = translation;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        // Состояние последнего перевода в конкретном поле — чтобы повторное нажатие
        // хоткея (пока текст никто не трогал) откатывало перевод обратно к оригиналу.
        const fieldTranslationState = new WeakMap();
        let fieldTranslationInFlight = false;

        function getFieldCurrentFullText(el) {
            return (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value : (el.innerText || el.textContent || '');
        }

        function setFieldBusyVisual(el, busy) {
            if (!el) return;
            if (busy) {
                if (el.dataset.utstPrevOutline === undefined) el.dataset.utstPrevOutline = el.style.outline || '';
                el.style.outline = '2px solid rgba(120,170,255,0.55)';
                el.style.outlineOffset = '-1px';
            } else {
                el.style.outline = el.dataset.utstPrevOutline || '';
                el.style.outlineOffset = '';
                delete el.dataset.utstPrevOutline;
            }
        }

        function restoreFieldOriginal(el, state) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                setNativeFieldValue(el, state.originalFull);
                el.setSelectionRange(state.originalFull.length, state.originalFull.length);
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                el.textContent = state.originalFull;
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            el.focus();
        }

        function translateEditableField(context) {
            if (fieldTranslationInFlight) return;

            // Тот же хоткей сразу после перевода в том же поле (текст не менялся вручную) — откат.
            const prevState = fieldTranslationState.get(context.el);
            if (prevState && Date.now() - prevState.timestamp < 6000 && getFieldCurrentFullText(context.el) === prevState.translatedFull) {
                restoreFieldOriginal(context.el, prevState);
                fieldTranslationState.delete(context.el);
                return;
            }

            fieldTranslationInFlight = true;
            setFieldBusyVisual(context.el, true);
            const originalFull = getFieldCurrentFullText(context.el);
            const targetVal = getFieldTargetLanguage();
            translateText(context.text, 'auto', targetVal, (translation) => {
                fieldTranslationInFlight = false;
                setFieldBusyVisual(context.el, false);
                if (!translation || translation === errors.noText) return;
                replaceEditableFieldText(context, translation);
                fieldTranslationState.set(context.el, { originalFull, translatedFull: getFieldCurrentFullText(context.el), timestamp: Date.now() });
            }, null, GM_getValue('fieldTranslateEngine', 'google'));
        }

        // Отдельный хоткей для перевода полей ввода — capture-фаза, чтобы перехватить
        // событие раньше собственного обработчика сайта (например, отправки сообщения в CRM по Ctrl+Enter).
        document.addEventListener('keydown', (e) => {
            if (fieldShortcutCaptureActive || shortcutCaptureActive) return;
            if (!shortcutMatchesEvent(currentFieldShortcut, e)) return;
            const fieldContext = getEditableFieldContext();
            if (!fieldContext) return;
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            translateEditableField(fieldContext);
        }, true);

        document.addEventListener('keydown', (e) => {
            if (!shortcutCaptureActive && shortcutMatchesEvent(currentShortcut, e)) {
                e.preventDefault();
                const context = getSelectionContext();
                openTranslationPanelForText(context ? context.text : '', context ? context.position : null);
            }
        });

        // ===== Перевод всей страницы =====
        const PAGE_SHORTCUT_KEY = 'pageTranslateShortcut';
        const DEFAULT_PAGE_SHORTCUT = Object.freeze({
            ctrl: true, alt: false, shift: true, meta: false,
            key: 'l', code: 'KeyL', displayKey: 'L'
        });
        function cloneDefaultPageShortcut() { return { ...DEFAULT_PAGE_SHORTCUT }; }
        function normalizePageShortcutCandidate(value) {
            if (!value || typeof value !== 'object') return cloneDefaultPageShortcut();
            const legacyKey = String(value.key || '').toLowerCase();
            const code = String(value.code || getShortcutCodeFromLegacyKey(legacyKey));
            const displayKey = getDisplayKeyFromCode(code, legacyKey);
            const shortcut = { ctrl: !!value.ctrl, alt: !!value.alt, shift: !!value.shift, meta: !!value.meta, key: legacyKey, code, displayKey };
            if (!shortcut.code || !hasShortcutModifier(shortcut) || isModifierShortcutCode(shortcut.code) || isModifierShortcutKey(shortcut.key)) {
                return cloneDefaultPageShortcut();
            }
            return shortcut;
        }
        function loadPageShortcutSetting() {
            const saved = GM_getValue(PAGE_SHORTCUT_KEY, null);
            const normalized = normalizePageShortcutCandidate(saved);
            if (!saved || JSON.stringify(saved) !== JSON.stringify(normalized)) GM_setValue(PAGE_SHORTCUT_KEY, normalized);
            return normalized;
        }
        let pageShortcutCaptureActive = false;
        let currentPageShortcut = loadPageShortcutSetting();
        function updatePageShortcutSettingsUi(message = '') {
            const btn = translationBox.querySelector('#pageShortcutCaptureButton');
            const help = translationBox.querySelector('#pageShortcutCaptureHelp');
            if (!btn && !help) return;
            if (btn) {
                btn.textContent = pageShortcutCaptureActive ? 'Нажмите клавиши...' : formatShortcut(currentPageShortcut);
                btn.classList.toggle('is-recording', pageShortcutCaptureActive);
                btn.setAttribute('aria-pressed', pageShortcutCaptureActive ? 'true' : 'false');
            }
            if (help) help.textContent = message || 'Нажмите, затем введите сочетание с Ctrl, Alt, Shift или Cmd.';
        }
        function savePageShortcutSetting(shortcut) {
            currentPageShortcut = normalizePageShortcutCandidate(shortcut);
            GM_setValue(PAGE_SHORTCUT_KEY, currentPageShortcut);
            updatePageShortcutSettingsUi();
            return currentPageShortcut;
        }
        function bindPageShortcutControls() {
            const btn = translationBox.querySelector('#pageShortcutCaptureButton');
            const resetBtn = translationBox.querySelector('#pageShortcutResetButton');
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    pageShortcutCaptureActive = true;
                    updatePageShortcutSettingsUi();
                    btn.focus();
                });
                btn.addEventListener('keydown', (e) => {
                    if (!pageShortcutCaptureActive) return;
                    e.preventDefault(); e.stopPropagation();
                    if (e.key === 'Escape' && !hasShortcutModifier({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey })) {
                        pageShortcutCaptureActive = false;
                        updatePageShortcutSettingsUi();
                        return;
                    }
                    const candidate = shortcutFromKeyboardEvent(e);
                    if (!candidate || !hasShortcutModifier(candidate)) {
                        updatePageShortcutSettingsUi('Добавьте хотя бы Ctrl, Alt, Shift или Cmd.');
                        return;
                    }
                    pageShortcutCaptureActive = false;
                    savePageShortcutSetting(candidate);
                    updatePageShortcutSettingsUi('Сочетание сохранено.');
                });
                btn.addEventListener('blur', () => {
                    if (!pageShortcutCaptureActive) return;
                    pageShortcutCaptureActive = false;
                    updatePageShortcutSettingsUi();
                });
            }
            if (resetBtn) {
                resetBtn.addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    pageShortcutCaptureActive = false;
                    savePageShortcutSetting(cloneDefaultPageShortcut());
                });
            }
        }
        bindPageShortcutControls();
        updatePageShortcutSettingsUi();

        let pageTranslateStatusEl = null;

        function getPageTranslateStatusEl() {
            if (pageTranslateStatusEl && document.contains(pageTranslateStatusEl)) return pageTranslateStatusEl;
            const el = document.createElement('div');
            el.id = 'utstPageTranslateStatus';
            el.style.cssText = 'position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:2147483000; background:#242433; color:#fff; font: 12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif; padding:8px 14px; border-radius:20px; box-shadow:0 6px 18px rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.12); pointer-events:none; opacity:0; transition:opacity .15s ease;';
            document.documentElement.appendChild(el);
            pageTranslateStatusEl = el;
            return el;
        }
        function showPageTranslateStatus(text, autoHide) {
            const el = getPageTranslateStatusEl();
            el.textContent = text;
            el.style.opacity = '1';
            if (autoHide) setTimeout(() => { if (el) el.style.opacity = '0'; }, 1800);
        }

        function isOwnUiNode(node) {
            return !!(utstUi.host && node && utstUi.host.contains(node));
        }
        const PAGE_TRANSLATE_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'IFRAME', 'CODE', 'PRE', 'SVG', 'CANVAS']);
        function collectTextNodesIn(root) {
            const results = [];
            if (!root) return results;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    const text = node.nodeValue;
                    if (!text || !text.trim()) return NodeFilter.FILTER_REJECT;
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (PAGE_TRANSLATE_SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                    if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
                    if (isOwnUiNode(parent)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            let node;
            while ((node = walker.nextNode())) results.push(node);
            return results;
        }
        function collectPageTextNodes() {
            return collectTextNodesIn(document.body);
        }

        function translatePageNodesBatch(nodes, targetLang, engine, onProgress, onDone, targetMap) {
            const store = targetMap || pageTranslatedNodes;
            const BATCH_SIZE = 8;
            const MAX_CONCURRENT = 3;
            const batches = [];
            for (let i = 0; i < nodes.length; i += BATCH_SIZE) batches.push(nodes.slice(i, i + BATCH_SIZE));

            let doneCount = 0;
            let activeRequests = 0;
            let nextBatchIndex = 0;
            let stopped = false;

            function translateOneNode(node, cb) {
                translateText(node.nodeValue, 'auto', targetLang, (translation) => cb(translation), null, engine);
            }

            function processBatch(batch, cb) {
                const joined = batch.map(n => n.nodeValue).join('\n');
                translateText(joined, 'auto', targetLang, (translation) => {
                    const parts = typeof translation === 'string' ? translation.split('\n') : [];
                    if (parts.length === batch.length) { cb(parts); return; }
                    // Число строк после перевода не совпало — переводим узлы этой пачки по одному.
                    const results = new Array(batch.length);
                    let remaining = batch.length;
                    batch.forEach((node, idx) => {
                        translateOneNode(node, (t) => {
                            results[idx] = t;
                            remaining--;
                            if (remaining === 0) cb(results);
                        });
                    });
                }, null, engine);
            }

            function next() {
                if (stopped) return;
                if (nextBatchIndex >= batches.length && activeRequests === 0) { onDone(); return; }
                while (activeRequests < MAX_CONCURRENT && nextBatchIndex < batches.length) {
                    const batch = batches[nextBatchIndex++];
                    activeRequests++;
                    processBatch(batch, (results) => {
                        if (!stopped) {
                            batch.forEach((node, idx) => {
                                if (!store.has(node)) store.set(node, node.nodeValue);
                                const t = results[idx];
                                if (typeof t === 'string' && t) node.nodeValue = t;
                            });
                            doneCount += batch.length;
                            if (onProgress) onProgress(doneCount, nodes.length);
                        }
                        activeRequests--;
                        next();
                    });
                }
            }
            next();
            return () => { stopped = true; };
        }

        function revertPageTranslation() {
            pageTranslatedNodes.forEach((original, node) => {
                try { node.nodeValue = original; } catch (e) { /* узел мог исчезнуть из DOM — пропускаем */ }
            });
            pageTranslatedNodes = new Map();
            pageTranslateActive = false;
            showPageTranslateStatus('Показан оригинал страницы', true);
        }

        function translateWholePage() {
            if (pageTranslateInFlight) return;
            if (pageTranslateActive) { revertPageTranslation(); return; }
            const nodes = collectPageTextNodes();
            if (!nodes.length) { showPageTranslateStatus('На странице нечего переводить', true); return; }

            let targetLang = GM_getValue('pageTranslateLang', defaultTargetLang);
            if (targetLang === 'navigator' || !targetLang) targetLang = browserLang;
            const engine = GM_getValue('pageTranslateEngine', 'google');

            pageTranslateInFlight = true;
            pageTranslateActive = true;
            showPageTranslateStatus(`Перевод страницы: 0 / ${nodes.length}`);

            translatePageNodesBatch(nodes, targetLang, engine, (done, total) => {
                showPageTranslateStatus(`Перевод страницы: ${done} / ${total}`);
            }, () => {
                pageTranslateInFlight = false;
                showPageTranslateStatus(`Страница переведена (${nodes.length} фрагментов)`, true);
            });
        }

        GM_registerMenuCommand('Перевести страницу / показать оригинал', () => translateWholePage());

        // ===== Перевод постоянной области (например, панель чата с лидом) =====
        // В отличие от разового перевода всей страницы, здесь: (1) область запоминается
        // по домену через GM-хранилище, (2) MutationObserver следит за появлением новых
        // узлов (новых сообщений) и переводит их автоматически, без повторных действий.
        function getAreaZoneConfig(hostname) {
            const all = GM_getValue('areaTranslateZones', {});
            return all[hostname || location.hostname] || null;
        }
        function setAreaZoneConfig(hostname, config) {
            const all = GM_getValue('areaTranslateZones', {});
            if (config === null) delete all[hostname]; else all[hostname] = config;
            GM_setValue('areaTranslateZones', all);
        }

        function buildElementSelector(el) {
            if (!el || el === document.body) return 'body';
            const parts = [];
            let node = el;
            let depth = 0;
            while (node && node.nodeType === 1 && node !== document.body && depth < 8) {
                let part = node.tagName.toLowerCase();
                if (node.id) { parts.unshift(part + '#' + CSS.escape(node.id)); break; }
                const parent = node.parentElement;
                if (parent) {
                    const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
                    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                }
                parts.unshift(part);
                node = parent;
                depth++;
            }
            return parts.join(' > ');
        }

        function deactivateAreaZone() {
            if (areaZoneState.observer) { areaZoneState.observer.disconnect(); areaZoneState.observer = null; }
            if (areaZoneState.debounceTimer) { clearTimeout(areaZoneState.debounceTimer); areaZoneState.debounceTimer = null; }
            areaZoneState.el = null;
            areaZoneState.active = false;
        }

        function scheduleZoneRetranslate() {
            if (areaZoneState.debounceTimer) clearTimeout(areaZoneState.debounceTimer);
            areaZoneState.debounceTimer = setTimeout(() => {
                if (!areaZoneState.active || !areaZoneState.el || !document.contains(areaZoneState.el)) { deactivateAreaZone(); return; }
                const allNodes = collectTextNodesIn(areaZoneState.el);
                const newNodes = allNodes.filter(n => !areaZoneState.translatedMap.has(n));
                if (newNodes.length) {
                    translatePageNodesBatch(newNodes, areaZoneState.targetLang, areaZoneState.engine, null, () => {}, areaZoneState.translatedMap);
                }
            }, 500);
        }

        function activateAreaZone(selector, targetLang, engine) {
            deactivateAreaZone();
            const el = document.querySelector(selector);
            if (!el) { showPageTranslateStatus('Область для перевода не найдена на странице', true); return false; }

            areaZoneState.el = el;
            areaZoneState.translatedMap = new Map();
            areaZoneState.active = true;
            areaZoneState.targetLang = targetLang;
            areaZoneState.engine = engine;

            const initialNodes = collectTextNodesIn(el);
            if (initialNodes.length) {
                translatePageNodesBatch(initialNodes, targetLang, engine, null, () => {
                    showPageTranslateStatus(`Область переведена (${initialNodes.length} фрагментов), новые сообщения будут переводиться автоматически`, true);
                }, areaZoneState.translatedMap);
            }

            const observer = new MutationObserver((mutationsList) => {
                let needsWork = false;
                for (const m of mutationsList) {
                    if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) { needsWork = true; break; }
                    if (m.type === 'characterData') { needsWork = true; break; }
                }
                if (needsWork) scheduleZoneRetranslate();
            });
            observer.observe(el, { childList: true, subtree: true, characterData: true });
            areaZoneState.observer = observer;
            return true;
        }

        function ensureAreaPickerOverlay() {
            let el = document.getElementById('utstAreaPickerOverlay');
            if (el) return el;
            el = document.createElement('div');
            el.id = 'utstAreaPickerOverlay';
            el.style.cssText = 'position:fixed; pointer-events:none; z-index:2147483000; border:2px solid #6cf; background:rgba(102,204,255,0.15); border-radius:4px; display:none;';
            document.documentElement.appendChild(el);
            return el;
        }

        function finishAreaPicker(el) {
            if (areaPickerCleanup) { areaPickerCleanup(); areaPickerCleanup = null; }
            areaPickerActive = false;
            const done = areaPickerDoneCallback; areaPickerDoneCallback = null;
            if (!el) { showPageTranslateStatus('Выбор области отменён', true); if (done) done(); return; }

            const selector = buildElementSelector(el);
            let targetLang = GM_getValue('areaTranslateLangDefault', defaultTargetLang);
            if (targetLang === 'navigator' || !targetLang) targetLang = browserLang;
            const engine = GM_getValue('areaTranslateEngineDefault', 'google');
            const cfg = { selector, targetLang, engine, enabled: true };
            setAreaZoneConfig(location.hostname, cfg);
            showPageTranslateStatus('Область сохранена — перевожу...');
            activateAreaZone(selector, targetLang, engine);
            if (done) done();
        }

        function startAreaPicker(onDone) {
            if (areaPickerActive) return;
            areaPickerActive = true;
            areaPickerDoneCallback = onDone || null;
            const overlay = ensureAreaPickerOverlay();
            overlay.style.display = 'block';
            showPageTranslateStatus('Наведите на область для постоянного перевода и кликните. Esc — отмена.');

            function onMove(e) {
                const el = document.elementFromPoint(e.clientX, e.clientY);
                if (!el || isOwnUiNode(el) || el === areaPickerHoveredEl) return;
                areaPickerHoveredEl = el;
                const rect = el.getBoundingClientRect();
                overlay.style.left = rect.left + 'px';
                overlay.style.top = rect.top + 'px';
                overlay.style.width = rect.width + 'px';
                overlay.style.height = rect.height + 'px';
            }
            function onClick(e) {
                e.preventDefault(); e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                finishAreaPicker(areaPickerHoveredEl);
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); finishAreaPicker(null); }
            }
            document.addEventListener('mousemove', onMove, true);
            document.addEventListener('click', onClick, true);
            document.addEventListener('keydown', onKey, true);
            areaPickerCleanup = () => {
                document.removeEventListener('mousemove', onMove, true);
                document.removeEventListener('click', onClick, true);
                document.removeEventListener('keydown', onKey, true);
                overlay.style.display = 'none';
                areaPickerHoveredEl = null;
            };
        }

        GM_registerMenuCommand('Выбрать область для постоянного перевода', () => startAreaPicker());

        // Автозапуск сохранённой для этого домена области при загрузке страницы —
        // с повторными попытками, т.к. в SPA-интерфейсах (типичная CRM) нужный блок
        // часто появляется в DOM не сразу.
        (function autoActivateSavedZone() {
            const savedCfg = getAreaZoneConfig();
            if (!savedCfg || !savedCfg.enabled) return;
            let attempts = 0;
            function tryActivate() {
                attempts++;
                if (document.querySelector(savedCfg.selector)) {
                    activateAreaZone(savedCfg.selector, savedCfg.targetLang, savedCfg.engine);
                    return;
                }
                if (attempts < 20) setTimeout(tryActivate, 750);
            }
            if (document.readyState === 'complete' || document.readyState === 'interactive') tryActivate();
            else document.addEventListener('DOMContentLoaded', tryActivate, { once: true });
        })();

        document.addEventListener('keydown', (e) => {
            if (pageShortcutCaptureActive || shortcutCaptureActive || fieldShortcutCaptureActive) return;
            if (!shortcutMatchesEvent(currentPageShortcut, e)) return;
            e.preventDefault();
            translateWholePage();
        }, true);

        if (GM_getValue('pageTranslateAuto', false) && !isCurrentSiteBlacklisted()) {
            const runAutoPageTranslate = () => setTimeout(() => translateWholePage(), 600);
            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                runAutoPageTranslate();
            } else {
                document.addEventListener('DOMContentLoaded', runAutoPageTranslate, { once: true });
            }
        }


        function handleLanguageChange() {
            stopSpeaking();
            const targetVal = targetLangSelect.value;
            currentResolvedTargetLang = targetVal === 'navigator' ? browserLang : targetVal;

            const sourceVal = sourceLangSelect.value;
            if (sourceVal !== 'auto') {
                detectedSourceLang = sourceVal;
            }

            if (currentSelectedText) {
                runPanelTranslation(currentSelectedText, sourceVal, targetVal, (translation, pos, resolvedTargetLang) => {
                    currentTranslatedText = translation;
                    translationText.textContent = translation;
                    currentResolvedTargetLang = resolvedTargetLang || currentResolvedTargetLang;
                }, { x: parseFloat(translationBox.style.left), y: parseFloat(translationBox.style.top) }, 'language', GM_getValue('panelTranslateEngine', 'google'));
            }
        }


        sourceLangSelect.addEventListener('change', handleLanguageChange);
        targetLangSelect.addEventListener('change', () => {
            ensureSelectValue(targetLangSelect, targetLangSelect.value);
            handleLanguageChange();
        });

        speakButton.addEventListener('mouseenter', () => {
            speakTooltip.style.display = 'block';
        });
        speakButton.addEventListener('mouseleave', () => {
            speakTooltip.style.display = 'none';
        });
        speakButton.addEventListener('click', (e) => {
            if (speakTooltip && eventPathContains(e, speakTooltip)) return;
            if (speechPlaying && currentSpeakerId && currentSpeakerId.startsWith('panel-')) {
                e.preventDefault();
                e.stopPropagation();
                stopSpeaking();
                speakTooltip.style.display = 'none';
            }
        });

        speakTranslated.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentTranslatedText) {
                const langForSpeech = resolveTargetSpeechLanguage(targetLangSelect ? targetLangSelect.value : currentResolvedTargetLang, currentResolvedTargetLang);
                speak(currentTranslatedText, langForSpeech, 'panel-translated');
            }
        });

        speakOriginal.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentSelectedText) {
                speak(currentSelectedText, resolveSourceSpeechLanguage(sourceLangSelect ? sourceLangSelect.value : 'auto'), 'panel-original');
            }
        });

        copyButton.addEventListener('click', () => {
            if (currentTranslatedText) {
                navigator.clipboard.writeText(currentTranslatedText);
                setButtonIconStroke(copyButton, COPY_FEEDBACK_STROKE);
                setTimeout(() => {
                    applyIconThemeColors();
                }, 1000);
            }
        });

        const replySuggestionCopyButton = translationBox.querySelector('#replySuggestionCopy');
        const replySuggestionRefreshButton = translationBox.querySelector('#replySuggestionRefresh');
        if (replySuggestionCopyButton) {
            replySuggestionCopyButton.addEventListener('click', () => {
                const replyTextEl = translationBox.querySelector('#replySuggestionText');
                const text = replyTextEl ? replyTextEl.textContent : '';
                if (text) {
                    navigator.clipboard.writeText(text);
                    setButtonIconStroke(replySuggestionCopyButton, COPY_FEEDBACK_STROKE);
                    setTimeout(() => applyIconThemeColors(), 1000);
                }
            });
        }
        if (replySuggestionRefreshButton) {
            replySuggestionRefreshButton.addEventListener('click', () => {
                if (lastReplySuggestionSourceText) generateReplySuggestion(lastReplySuggestionSourceText);
            });
        }

        function openFullscreenOverlay() {
            hideSelectionBubble();
            hideBubbleCloseMenu();
            lockPageScrollForFullscreen();
            fullscreenOverlay.style.display = 'flex';
            fullscreenSource.value = currentSelectedText || '';
            fullscreenTarget.value = currentTranslatedText || '';
            if (fullscreenSourceLangSelect) {
                const srcVal = sourceLangSelect ? sourceLangSelect.value : 'auto';
                fullscreenSourceLangSelect.value = fullscreenSourceLangSelect.querySelector(`option[value="${srcVal}"]`) ? srcVal : 'auto';
            }
            if (fullscreenTargetLangSelect) {
                const tgtVal = targetLangSelect ? targetLangSelect.value : defaultTargetLang;
                ensureFullscreenTargetLanguageValid(tgtVal);
            }
            updateFullscreenSourceCurrentLabel();
            updateFullscreenTargetCurrentLabel();
            hideLanguagePanels();
            refreshLanguagePanelTheme();
            renderLanguageGrid(fullscreenSourceLangGrid, fullscreenSourceLangSearch, fullscreenSourceLangSelect, fullscreenSourceLangCurrent, fullscreenSourceLangPanel);
            renderLanguageGrid(fullscreenTargetLangGrid, fullscreenTargetLangSearch, fullscreenTargetLangSelect, fullscreenTargetLangCurrent, fullscreenTargetLangPanel);
            syncFullscreenTextareaHeights();
            if (!fullscreenTarget.value && fullscreenSource.value.trim()) {
                scheduleFullscreenTranslate(350, 'translate');
            }
        }

        function closeFullscreenOverlay() {
            fullscreenTranslateRequestId++;
            setFullscreenLoading(false);
            fullscreenTextareaResizePending = false;
            fullscreenTextareaResizeActive = null;
            fullscreenTextareaResizeStartHeight = 0;
            fullscreenTextareaLastSyncedHeight = 0;
            if (fullscreenTextareaResizeRaf) {
                cancelAnimationFrame(fullscreenTextareaResizeRaf);
                fullscreenTextareaResizeRaf = 0;
            }
            fullscreenOverlay.style.display = 'none';
            unlockPageScrollForFullscreen();
            stopSpeaking();
            scheduleSelectionBubbleUpdate(0);
        }

        function translateInFullscreen(reason = 'translate') {
            const text = fullscreenSource.value || '';
            const target = fullscreenTargetLangSelect
                ? ensureFullscreenTargetLanguageValid(fullscreenTargetLangSelect.value)
                : (targetLangSelect ? targetLangSelect.value : defaultTargetLang);
            const srcLang = fullscreenSourceLangSelect ? fullscreenSourceLangSelect.value || 'auto' : 'auto';
            const requestId = ++fullscreenTranslateRequestId;
            if (!text.trim()) {
                setFullscreenLoading(false, reason === 'language' ? 'language' : 'translate');
                fullscreenTarget.value = '';
                return;
            }
            setFullscreenLoading(true, reason === 'language' ? 'language' : 'translate');
            translateText(text, srcLang, target, (translation, pos, resolvedTargetLang) => {
                if (requestId !== fullscreenTranslateRequestId) return;
                setFullscreenLoading(false, reason === 'language' ? 'language' : 'translate');
                fullscreenTarget.value = translation;
                currentResolvedTargetLang = resolvedTargetLang || currentResolvedTargetLang;
                updateFullscreenSourceCurrentLabel();
                updateFullscreenTargetCurrentLabel();
            }, { x: 0, y: 0 }, GM_getValue('panelTranslateEngine', 'google'));
        }

        function scheduleFullscreenTranslate(delay = 250, reason = 'translate') {
            if (fullscreenTranslateTimer) clearTimeout(fullscreenTranslateTimer);
            fullscreenTranslateReason = reason === 'language' ? 'language' : 'translate';
            fullscreenTranslateTimer = setTimeout(() => {
                fullscreenTranslateTimer = null;
                translateInFullscreen(fullscreenTranslateReason);
            }, delay);
        }

        function hideLanguagePanels() {
            if (fullscreenSourceLangPanel) fullscreenSourceLangPanel.style.display = 'none';
            if (fullscreenTargetLangPanel) fullscreenTargetLangPanel.style.display = 'none';
        }

        function getLanguageGridCurrentValue(selectEl) {
            const firstUsableOption = Array.from(selectEl.options || []).find(opt => !opt.disabled && opt.value);
            if (selectEl.value) return selectEl.value;
            if (selectEl.querySelector('option[value="auto"]')) return 'auto';
            return firstUsableOption ? firstUsableOption.value : defaultTargetLang;
        }

        function getLanguageGridOptions(selectEl, customOptions) {
            if (customOptions && customOptions.length) {
                return customOptions.map(({ value, label }) => ({ code: value, name: label }));
            }
            return Array.from(selectEl.options)
                .filter(option => !option.disabled && option.value)
                .map(option => ({ code: option.value, name: option.textContent || getLanguageLabel(option.value) }));
        }

        function languageGridOptionMatchesQuery(option, query) {
            if (!query) return true;
            const name = String(option.name || '').toLowerCase();
            const code = String(option.code || '').toLowerCase();
            return name.includes(query) || code.includes(query);
        }

        function buildLanguageGridButton(option, current, style) {
            const active = option.code === current;
            return `<button data-code="${option.code}" style="
                padding:6px 8px;
                text-align:left;
                border-radius:8px;
                border:1px solid ${active ? style.buttonActiveBorder : style.buttonBorder};
                background:${active ? style.buttonActiveBg : style.buttonBg};
                color:${active && style.buttonActiveColor ? style.buttonActiveColor : style.buttonColor};
                font-weight:${active ? (style.buttonActiveWeight || 600) : (style.buttonWeight || 500)};
                box-shadow:${active ? (style.buttonActiveShadow || 'none') : 'none'};
                cursor:pointer;
                font-size:12px;
                transition:background 0.15s ease, border 0.15s ease;
            ">${option.name}</button>`;
        }

        function updateLanguageGridCurrentLabel(currentLabelEl, code) {
            if (currentLabelEl === fullscreenSourceLangCurrent) {
                updateFullscreenSourceCurrentLabel();
            } else if (currentLabelEl === fullscreenTargetLangCurrent) {
                updateFullscreenTargetCurrentLabel();
            } else if (currentLabelEl) {
                currentLabelEl.textContent = getLanguageLabel(code);
            }
        }

        function applyLanguageGridSelection(code, selectEl) {
            stopSpeaking();
            selectEl.value = code;
            if (selectEl === fullscreenTargetLangSelect) {
                const validTarget = ensureFullscreenTargetLanguageValid(code);
                currentResolvedTargetLang = resolveTargetLanguageValue(validTarget, currentResolvedTargetLang || defaultTargetLang);
            } else if (selectEl === fullscreenSourceLangSelect && code !== 'auto') {
                detectedSourceLang = code;
            }
        }

        function bindLanguageGridButtons(gridEl, searchEl, selectEl, currentLabelEl, panelEl, customOptions) {
            gridEl.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    const code = btn.getAttribute('data-code');
                    if (!code || !selectEl.querySelector(`option[value="${code}"]`)) return;
                    applyLanguageGridSelection(code, selectEl);
                    updateLanguageGridCurrentLabel(currentLabelEl, code);
                    renderLanguageGrid(gridEl, searchEl, selectEl, currentLabelEl, panelEl, customOptions);
                    if (panelEl) panelEl.style.display = 'none';
                    if (selectEl === fullscreenTargetLangSelect || selectEl === fullscreenSourceLangSelect) {
                        scheduleFullscreenTranslate(0, 'language');
                    }
                });
            });
        }

        function renderLanguageGrid(gridEl, searchEl, selectEl, currentLabelEl, panelEl, customOptions) {
            if (!gridEl || !selectEl) return;
            const style = getLanguagePanelThemeStyles();
            applyLanguagePanelContainerTheme(panelEl, searchEl);
            const query = (searchEl && searchEl.value || '').toLowerCase();
            const current = getLanguageGridCurrentValue(selectEl);
            const buttons = getLanguageGridOptions(selectEl, customOptions)
                .filter(option => languageGridOptionMatchesQuery(option, query))
                .map(option => buildLanguageGridButton(option, current, style));
            gridEl.innerHTML = buttons.join('');
            bindLanguageGridButtons(gridEl, searchEl, selectEl, currentLabelEl, panelEl, customOptions);
            updateLanguageGridCurrentLabel(currentLabelEl, current);
        }

        function bindFullscreenActionControls() {
        if (fullscreenSourceCopy) fullscreenSourceCopy.addEventListener('click', () => {
            const text = fullscreenSource.value || '';
            if (!text) return;
            navigator.clipboard.writeText(text);
            const svg = fullscreenSourceCopy.querySelector('svg');
            if (svg) {
                setButtonIconStroke(fullscreenSourceCopy, COPY_FEEDBACK_STROKE);
                setTimeout(() => { applyIconThemeColors(); }, 900);
            }
        });

        if (fullscreenTargetCopy) fullscreenTargetCopy.addEventListener('click', () => {
            const text = fullscreenTarget.value || '';
            if (!text) return;
            navigator.clipboard.writeText(text);
            const svg = fullscreenTargetCopy.querySelector('svg');
            if (svg) {
                setButtonIconStroke(fullscreenTargetCopy, COPY_FEEDBACK_STROKE);
                setTimeout(() => { applyIconThemeColors(); }, 900);
            }
        });

        if (fullscreenSourceSpeak) fullscreenSourceSpeak.addEventListener('click', () => {
            const text = fullscreenSource.value.trim();
            if (!text) return;
            if (speechPlaying && currentSpeakerId === 'fs-source') {
                stopSpeaking();
                return;
            }
            const selectedSrc = fullscreenSourceLangSelect ? fullscreenSourceLangSelect.value : 'auto';
            const langForSpeech = resolveSourceSpeechLanguage(selectedSrc);
            speak(text, langForSpeech, 'fs-source');
        });

        if (fullscreenTargetSpeak) fullscreenTargetSpeak.addEventListener('click', () => {
            const text = fullscreenTarget.value.trim();
            if (!text) return;
            if (speechPlaying && currentSpeakerId === 'fs-target') {
                stopSpeaking();
                return;
            }
            const selectedTarget = fullscreenTargetLangSelect ? fullscreenTargetLangSelect.value : (targetLangSelect ? targetLangSelect.value : defaultTargetLang);
            const tgtLang = resolveTargetSpeechLanguage(selectedTarget, currentResolvedTargetLang);
            speak(text, tgtLang || browserLang, 'fs-target');
        });

        if (fullscreenSourceLangSearch) fullscreenSourceLangSearch.addEventListener('input', () => {
            renderLanguageGrid(fullscreenSourceLangGrid, fullscreenSourceLangSearch, fullscreenSourceLangSelect, fullscreenSourceLangCurrent, fullscreenSourceLangPanel);
        });
        if (fullscreenTargetLangSearch) fullscreenTargetLangSearch.addEventListener('input', () => {
            renderLanguageGrid(fullscreenTargetLangGrid, fullscreenTargetLangSearch, fullscreenTargetLangSelect, fullscreenTargetLangCurrent, fullscreenTargetLangPanel);
        });
        }

        bindFullscreenActionControls();

        function markFullscreenResizeStart(e) {
            if (!e || !e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (!rect || !rect.height) return;
            const resizeZone = 18;
            const isNearBottom = (rect.bottom - e.clientY) <= resizeZone;
            if (!isNearBottom) return;
            fullscreenTextareaResizePending = true;
            fullscreenTextareaResizeActive = e.currentTarget;
            fullscreenTextareaResizeStartHeight = Math.round(rect.height);
            fullscreenTextareaLastSyncedHeight = fullscreenTextareaResizeStartHeight;
        }

        function bindFullscreenInputControls() {
        if (fullscreenSource) fullscreenSource.addEventListener('pointerdown', markFullscreenResizeStart);
        if (fullscreenTarget) fullscreenTarget.addEventListener('pointerdown', markFullscreenResizeStart);
        if (fullscreenSource) {
            fullscreenSource.addEventListener('input', () => scheduleFullscreenTranslate(250, 'translate'));
            fullscreenSource.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    scheduleFullscreenTranslate(0, 'translate');
                }
            });
        }
        if (fullscreenSourceLangSelect) fullscreenSourceLangSelect.addEventListener('change', () => {
            if (fullscreenSourceLangSelect.value !== 'auto') {
                detectedSourceLang = fullscreenSourceLangSelect.value;
            }
            updateFullscreenSourceCurrentLabel();
            scheduleFullscreenTranslate(0, 'language');
        });
        if (fullscreenTargetLangSelect) fullscreenTargetLangSelect.addEventListener('change', () => {
            const validTarget = ensureFullscreenTargetLanguageValid(fullscreenTargetLangSelect.value);
            currentResolvedTargetLang = resolveTargetLanguageValue(validTarget, currentResolvedTargetLang || defaultTargetLang);
            updateFullscreenTargetCurrentLabel();
            scheduleFullscreenTranslate(0, 'language');
        });
        }

        bindFullscreenInputControls();

        function swapFullscreenContent() {
            if (!fullscreenSource || !fullscreenTarget || !fullscreenSourceLangSelect || !fullscreenTargetLangSelect) return;
            stopSpeaking();

            const srcText = fullscreenSource.value;
            fullscreenSource.value = fullscreenTarget.value;
            fullscreenTarget.value = srcText;

            const srcLang = fullscreenSourceLangSelect.value || 'auto';
            const tgtLang = fullscreenTargetLangSelect.value || defaultTargetLang;
            fullscreenSourceLangSelect.value = fullscreenSourceLangSelect.querySelector(`option[value="${tgtLang}"]`) ? tgtLang : 'auto';

            let swappedTargetLang = srcLang;
            if (swappedTargetLang === 'auto') {
                swappedTargetLang = resolveTargetLanguageValue(
                    (detectedSourceLang && detectedSourceLang !== 'auto') ? detectedSourceLang : currentResolvedTargetLang,
                    defaultTargetLang
                );
            }

            const validTarget = ensureFullscreenTargetLanguageValid(swappedTargetLang);
            currentResolvedTargetLang = resolveTargetLanguageValue(validTarget, defaultTargetLang);
            if (fullscreenSourceLangSelect.value !== 'auto') {
                detectedSourceLang = fullscreenSourceLangSelect.value;
            }

            updateFullscreenSourceCurrentLabel();
            updateFullscreenTargetCurrentLabel();

            scheduleFullscreenTranslate(0, 'language');
        }

        function bindFullscreenLanguageControls() {
        if (fullscreenSwap) {
            fullscreenSwap.addEventListener('click', () => {
                swapFullscreenContent();
                fullscreenSwapRotation += 360;
                fullscreenSwap.style.transform = `rotate(${fullscreenSwapRotation}deg)`;
            });
        }

        function togglePanel(panelEl, otherPanel) {
            if (!panelEl) return;
            const isOpen = panelEl.style.display === 'block';
            hideLanguagePanels();
            panelEl.style.display = isOpen ? 'none' : 'block';
        }

        if (fullscreenSourceLangTrigger) fullscreenSourceLangTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel(fullscreenSourceLangPanel, fullscreenTargetLangPanel);
            renderLanguageGrid(fullscreenSourceLangGrid, fullscreenSourceLangSearch, fullscreenSourceLangSelect, fullscreenSourceLangCurrent, fullscreenSourceLangPanel);
        });

        if (fullscreenTargetLangTrigger) fullscreenTargetLangTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel(fullscreenTargetLangPanel, fullscreenSourceLangPanel);
            renderLanguageGrid(fullscreenTargetLangGrid, fullscreenTargetLangSearch, fullscreenTargetLangSelect, fullscreenTargetLangCurrent, fullscreenTargetLangPanel);
        });
        }

        bindFullscreenLanguageControls();

        document.addEventListener('mousedown', (e) => {
            if (selectionBubble && !eventPathContains(e, selectionBubble)) {
                hideBubbleCloseMenu();
            }
            if (fullscreenSourceLangPanel && !eventPathContains(e, fullscreenSourceLangPanel) && fullscreenSourceLangTrigger && !eventPathContains(e, fullscreenSourceLangTrigger)) {
                fullscreenSourceLangPanel.style.display = 'none';
            }
            if (fullscreenTargetLangPanel && !eventPathContains(e, fullscreenTargetLangPanel) && fullscreenTargetLangTrigger && !eventPathContains(e, fullscreenTargetLangTrigger)) {
                fullscreenTargetLangPanel.style.display = 'none';
            }
            if (panelThemePanel && !eventPathContains(e, panelThemePanel) && panelThemeTrigger && !eventPathContains(e, panelThemeTrigger)) {
                panelThemePanel.style.display = 'none';
            }
            inlineLanguagePanels.forEach(({ panel, selectEl }) => {
                if (!eventPathContains(e, panel) && !eventPathContains(e, selectEl)) {
                    panel.style.display = 'none';
                }
            });
        });

        function hideInlinePanels(except) {
            inlineLanguagePanels.forEach(p => {
                if (p.panel === except) return;
                p.panel.style.display = 'none';
            });
        }

        function positionInlinePanel(panel, selectEl) {
            if (!panel || panel.style.display !== 'block' || !selectEl) return;
            const rect = selectEl.getBoundingClientRect();
            const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
            const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const panelWidth = panel.offsetWidth || 280;
            const left = Math.min(rect.left + scrollX, scrollX + window.innerWidth - panelWidth - 10);
            const top = rect.bottom + scrollY + 4;
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        }

        function updateInlinePanelsPosition() {
            inlineLanguagePanels.forEach(({ panel, selectEl }) => {
                positionInlinePanel(panel, selectEl);
            });
            positionThemePanel();
        }

        function buildInlinePanel(selectEl, placeholder = langNames.navigator) {
            const panel = document.createElement('div');
            panel.style.cssText = `
            all: initial;
            display:none;
            position: absolute;
            width: 280px;
            max-height: 260px;
            background: rgba(30,30,47,0.98);
            border: 1px solid rgba(255,255,255,0.12);
            box-shadow: 0 10px 24px rgba(0,0,0,0.35);
            border-radius: 10px;
            padding: 8px;
            z-index: 2147483646;
        `;
            panel.innerHTML = `
            <input class="inlineLangSearch" placeholder="${placeholder}" style="width:100%; max-width:100%; box-sizing:border-box; padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.08); color:#fff; font-size:13px; outline:none;" />
            <div class="inlineLangGrid" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:6px; max-height:190px; overflow-y:auto; padding-top:8px;"></div>
        `;
            panel.classList.add('utst-inline-lang-panel');
            const searchEl = panel.querySelector('.inlineLangSearch');
            applyLanguagePanelContainerTheme(panel, searchEl);
            panel.classList.add("utst-scroll");
            utstUiRoot.appendChild(panel);
            inlineLanguagePanels.push({ panel, selectEl });
            return panel;
        }

        function attachInlineLanguagePanel(selectEl) {
            if (!selectEl) return;
            const panel = buildInlinePanel(selectEl);
            const searchEl = panel.querySelector('.inlineLangSearch');
            const gridEl = panel.querySelector('.inlineLangGrid');

            function render() {
                const opts = Array.from(selectEl.options)
                    .filter(o => !o.disabled)
                    .map(o => ({ value: o.value, label: o.textContent || o.value }));
                renderLanguageGrid(gridEl, searchEl, selectEl, null, panel, opts);
                gridEl.querySelectorAll('button').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const code = btn.getAttribute('data-code');
                        selectEl.value = code;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        hideInlinePanels();
                    });
                });
            }

            if (searchEl) searchEl.addEventListener('input', render);

            const openInlinePanel = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isOpen = panel.style.display === 'block';
                hideInlinePanels(panel);
                if (isOpen) {
                    panel.style.display = 'none';
                    return;
                }
                render();
                panel.style.display = 'block';
                positionInlinePanel(panel, selectEl);
            };

            selectEl.addEventListener('pointerdown', openInlinePanel, { capture: true });
            selectEl.addEventListener('mousedown', openInlinePanel);
            selectEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    openInlinePanel(e);
                }
            });
        }

        attachInlineLanguagePanel(sourceLangSelect);
        attachInlineLanguagePanel(targetLangSelect);
        attachInlineLanguagePanel(defaultTranslateLangSelect);
        attachInlineLanguagePanel(defaultSourceLangSelect);
        attachInlineLanguagePanel(toolLanguageSelect);
        attachInlineLanguagePanel(fieldTargetLangSelect);
        attachInlineLanguagePanel(translationBox.querySelector('#pageTranslateLang'));
        attachInlineLanguagePanel(translationBox.querySelector('#pageTranslateEngine'));
        attachInlineLanguagePanel(translationBox.querySelector('#areaTranslateLang'));
        attachInlineLanguagePanel(translationBox.querySelector('#areaTranslateEngine'));
        attachInlineLanguagePanel(translationBox.querySelector('#aiModelSelect'));
        attachInlineLanguagePanel(translationBox.querySelector('#aiProviderSelect'));
        attachInlineLanguagePanel(translationBox.querySelector('#nvidiaModelSelect'));
        attachInlineLanguagePanel(translationBox.querySelector('#panelTranslateEngine'));
        attachInlineLanguagePanel(translationBox.querySelector('#fieldTranslateEngine'));
        attachInlineLanguagePanel(translationBox.querySelector('#replySuggestionSource'));
        attachInlineLanguagePanel(translationBox.querySelector('#replySuggestionVariantMode'));
        attachInlineLanguagePanel(translationBox.querySelector('#replySuggestionLangSelect'));
        refreshLanguagePanelTheme();

        [translationBox, settingsPanel, fullscreenOverlay, fullscreenPanel].forEach((scrollEl) => {
            if (!scrollEl) return;
            scrollEl.addEventListener('scroll', () => {
                updateInlinePanelsPosition();
            }, { passive: true });
        });

        if (fullscreenToggle) fullscreenToggle.addEventListener('click', openFullscreenOverlay);
        if (fullscreenClose) fullscreenClose.addEventListener('click', closeFullscreenOverlay);
        const closeButton = translationBox.querySelector('#closeButton');

        function resizePanelForSettings() {
            if (!translationBox) return;
            translationBox.style.height = '';
            translationBox.style.minHeight = 'min(460px, calc(100vh - 40px))';
            translationBox.style.maxHeight = 'min(580px, calc(100vh - 40px))';
        }

        function restoreTranslateViewSize() {
            if (!translationBox) return;
            translationBox.style.height = '';
            translationBox.style.minHeight = '200px';
            translationBox.style.maxHeight = '360px';
        }

        closeButton.addEventListener('click', () => {
            panelTranslateRequestId++;
            setPanelLoading(false);
            translationBox.style.display = 'none';
            translationBox.style.opacity = '0';
            translationBox.style.transform = 'translateY(10px)';
            sourceLangSelect.value = 'auto';
            detectedSourceLang = 'auto';
            stopSpeaking();
            restoreTranslateViewSize();

            if (translatorPanel) translatorPanel.style.display = 'block';
            if (settingsPanel) settingsPanel.style.display = 'none';
            if (settingsHeader) settingsHeader.style.display = 'none';
            translationBox.classList.remove('utst-settings-open');
            scheduleSelectionBubbleUpdate(0);
        });

        settingsButton.addEventListener('click', () => {
            resizePanelForSettings();

            if (translatorPanel) translatorPanel.style.display = 'none';
            if (settingsPanel) settingsPanel.style.display = 'block';

            if (settingsHeaderTitle) settingsHeaderTitle.textContent = settingsTitle;
            if (settingsHeader) settingsHeader.style.display = 'flex';
            translationBox.classList.remove('utst-settings-open');
        });


        backButton.addEventListener('click', () => {
            restoreTranslateViewSize();
            if (translatorPanel) translatorPanel.style.display = 'block';
            if (settingsPanel) settingsPanel.style.display = 'none';

            if (settingsHeader) settingsHeader.style.display = 'none';
            translationBox.classList.remove('utst-settings-open');
        });





        function isClickInInlineLanguagePanel(event) {
            return inlineLanguagePanels.some(({ panel, selectEl }) =>
                eventPathContains(event, panel) || eventPathContains(event, selectEl)
            );
        }

        function isClickInFullscreenLanguagePanel(event) {
            return [fullscreenSourceLangPanel, fullscreenTargetLangPanel, fullscreenSourceLangTrigger, fullscreenTargetLangTrigger]
                .some(el => el && eventPathContains(event, el));
        }

        function isClickInProtectedOverlay(event) {
            return !!(
                isClickInInlineLanguagePanel(event) ||
                isClickInFullscreenLanguagePanel(event) ||
                (fullscreenOverlay && eventPathContains(event, fullscreenOverlay)) ||
                (selectionBubble && eventPathContains(event, selectionBubble)) ||
                (panelThemePanel && eventPathContains(event, panelThemePanel)) ||
                (panelThemeTrigger && eventPathContains(event, panelThemeTrigger))
            );
        }

        function closeTranslationBoxFromOutside() {
            panelTranslateRequestId++;
            setPanelLoading(false);
            translationBox.style.display = 'none';
            translationBox.style.opacity = '0';
            translationBox.style.transform = 'translateY(10px)';
            sourceLangSelect.value = 'auto';
            detectedSourceLang = 'auto';
            if (settingsHeader) settingsHeader.style.display = 'none';
            translationBox.classList.remove('utst-settings-open');
            stopSpeaking();
            scheduleSelectionBubbleUpdate(0);
        }

        function handleOutsideMouseDown(event) {
            if (isClickInProtectedOverlay(event) || eventPathContains(event, translationBox)) return;
            closeTranslationBoxFromOutside();
        }

        document.addEventListener('mousedown', handleOutsideMouseDown);

        function adjustBoxPosition() {
            const rect = translationBox.getBoundingClientRect();
            if (rect.right > window.innerWidth) {
                translationBox.style.left = `${window.innerWidth - rect.width - 10}px`;
            }
            if (rect.bottom > window.innerHeight) {
                translationBox.style.top = `${window.innerHeight - rect.height - 10}px`;
            }
        }


        translationBox.addEventListener('transitionend', adjustBoxPosition);

        document.addEventListener('selectionchange', () => {
            if (isSelectingPointer) {
                hideSelectionBubble();
                return;
            }
            scheduleSelectionBubbleUpdate();
        });
        document.addEventListener('mouseup', () => {
            if (fullscreenTextareaResizePending) {
                fullscreenTextareaResizePending = false;
                if (fullscreenOverlay.style.display === 'flex' && fullscreenTextareaResizeActive) {
                    const endHeight = Math.round(fullscreenTextareaResizeActive.getBoundingClientRect().height || 0);
                    if (Math.abs(endHeight - fullscreenTextareaResizeStartHeight) >= 1) {
                        syncFullscreenTextareaHeights(endHeight);
                    }
                }
                fullscreenTextareaResizeActive = null;
                fullscreenTextareaResizeStartHeight = 0;
                fullscreenTextareaLastSyncedHeight = 0;
                if (fullscreenTextareaResizeRaf) {
                    cancelAnimationFrame(fullscreenTextareaResizeRaf);
                    fullscreenTextareaResizeRaf = 0;
                }
            }
            isSelectingPointer = false;
            scheduleSelectionBubbleUpdate();
        }, true);
        document.addEventListener('keyup', () => {
            scheduleSelectionBubbleUpdate();
        });

        window.addEventListener('scroll', (e) => {
            if (isFullscreenOpen()) {
                return;
            }
            if (translationBox.style.display !== 'block' && e.target !== document && e.target !== document.documentElement) {
                return;
            }
            updateInlinePanelsPosition();
            scheduleSelectionBubbleUpdate(0);
        }, true);
        window.addEventListener('resize', () => {
            updateInlinePanelsPosition();
            syncFullscreenTextareaHeights();
            hideSelectionBubble();
            scheduleSelectionBubbleUpdate(40);
        });

        requestAnimationFrame(() => {
            utstUi.host.style.removeProperty('visibility');
            utstUi.host.style.removeProperty('pointer-events');
        });
    }

    if (document.body) {
        bootstrap();
    } else {
        window.addEventListener('DOMContentLoaded', bootstrap);
    }
})();
