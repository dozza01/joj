// ==UserScript==
// @name         OpenRouter Translator
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Переводчик на базе OpenRouter API с настройками модели, промпта и горячих клавиш
// @author       You
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      openrouter.ai
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ======================== НАСТРОЙКИ ПО УМОЛЧАНИЮ ========================
    const DEFAULTS = {
        apiKey: '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',
        model: 'google/gemini-2.0-flash-exp:free',
        prompt: 'Переведи следующий текст на русский язык. Ответь только переводом, без пояснений и кавычек.',
        hotkey: 'alt+a',
        targetLang: 'русский',
    };

    const FREE_MODELS = [
        'google/gemini-2.0-flash-exp:free',
        'google/gemma-3-27b-it:free',
        'meta-llama/llama-4-maverick:free',
        'qwen/qwen3-235b-a22b:free',
        'deepseek/deepseek-chat-v3-0324:free',
        'mistralai/mistral-small-3.1-24b-instruct:free',
        'nvidia/llama-3.1-nemotron-ultra-253b-v1:free',
    ];

    // ======================== УТИЛИТЫ ========================
    function getSetting(key) {
        const val = GM_getValue(key, undefined);
        return val !== undefined ? val : DEFAULTS[key];
    }
    function setSetting(key, val) {
        GM_setValue(key, val);
    }

    function parseHotkey(str) {
        const parts = str.toLowerCase().split('+').map(s => s.trim());
        return {
            alt: parts.includes('alt'),
            ctrl: parts.includes('ctrl'),
            shift: parts.includes('shift'),
            key: parts.find(p => !['alt', 'ctrl', 'shift'].includes(p)) || 'a',
        };
    }

    function matchesHotkey(e, hk) {
        return (
            e.altKey === hk.alt &&
            e.ctrlKey === hk.ctrl &&
            e.shiftKey === hk.shift &&
            e.key.toLowerCase() === hk.key
        );
    }

    // ======================== ПЕРЕВОД ЧЕРЕЗ API ========================
    function translate(text) {
        return new Promise((resolve, reject) => {
            const apiKey = getSetting('apiKey');
            if (!apiKey) {
                reject('API ключ не задан. Откройте настройки (⚙️).');
                return;
            }
            const model = getSetting('model');
            const prompt = getSetting('prompt');

            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://openrouter.ai/api/v1/chat/completions',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': location.href,
                    'X-Title': 'Tampermonkey Translator',
                },
                data: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: prompt },
                        { role: 'user', content: text },
                    ],
                    max_tokens: 2048,
                }),
                onload: function (resp) {
                    try {
                        const data = JSON.parse(resp.responseText);
                        if (data.choices && data.choices[0]) {
                            resolve(data.choices[0].message.content.trim());
                        } else if (data.error) {
                            reject(data.error.message || 'Ошибка API');
                        } else {
                            reject('Неизвестный ответ API');
                        }
                    } catch (err) {
                        reject('Ошибка парсинга ответа: ' + err.message);
                    }
                },
                onerror: function () {
                    reject('Сетевая ошибка при запросе к OpenRouter');
                },
            });
        });
    }

    // ======================== UI: ВСПЛЫВАЮЩИЙ РЕЗУЛЬТАТ ========================
    let tooltipEl = null;
    let tooltipTimer = null;

    function showTooltip(text, isError) {
        removeTooltip();

        tooltipEl = document.createElement('div');
        tooltipEl.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            max-width: 600px;
            min-width: 200px;
            max-height: 400px;
            overflow-y: auto;
            padding: 16px 20px;
            background: ${isError ? '#dc3545' : '#1e1e2e'};
            color: ${isError ? '#fff' : '#cdd6f4'};
            border-radius: 12px;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 15px;
            line-height: 1.5;
            z-index: 2147483647;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            white-space: pre-wrap;
            word-break: break-word;
            border: 1px solid ${isError ? '#a71d2a' : '#45475a'};
        `;

        // Заголовок
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-weight: bold;
            font-size: 13px;
            color: ${isError ? '#ffc9c9' : '#89b4fa'};
        `;
        header.textContent = isError ? '⚠ Ошибка' : '✓ Перевод';

        const closeBtn = document.createElement('span');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = 'cursor:pointer; font-size:16px; opacity:0.7;';
        closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.7';
        closeBtn.onclick = removeTooltip;
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.textContent = text;

        tooltipEl.appendChild(header);
        tooltipEl.appendChild(body);
        document.body.appendChild(tooltipEl);

        tooltipTimer = setTimeout(removeTooltip, 30000);
    }

    function removeTooltip() {
        if (tooltipEl) {
            tooltipEl.remove();
            tooltipEl = null;
        }
        if (tooltipTimer) {
            clearTimeout(tooltipTimer);
            tooltipTimer = null;
        }
    }

    function showLoading() {
        showTooltip('⏳ Перевожу...', false);
    }

    // ======================== UI: ПАНЕЛЬ НАСТРОЕК ========================
    let settingsPanel = null;

    function toggleSettings() {
        if (settingsPanel) {
            settingsPanel.remove();
            settingsPanel = null;
            return;
        }

        settingsPanel = document.createElement('div');
        settingsPanel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 520px;
            max-height: 85vh;
            overflow-y: auto;
            padding: 28px;
            background: #1e1e2e;
            color: #cdd6f4;
            border-radius: 16px;
            font-family: 'Segoe UI', system-ui, sans-serif;
            font-size: 14px;
            z-index: 2147483647;
            box-shadow: 0 12px 48px rgba(0,0,0,0.6);
            border: 1px solid #45475a;
        `;

        const title = document.createElement('h2');
        title.textContent = '⚙ Настройки переводчика';
        title.style.cssText = 'margin:0 0 20px; color:#89b4fa; font-size:18px;';
        settingsPanel.appendChild(title);

        // --- Поле: API ключ ---
        settingsPanel.appendChild(makeLabel('API ключ OpenRouter'));
        const apiKeyInput = makeInput('password', getSetting('apiKey'), 'sk-or-v1-...');
        settingsPanel.appendChild(apiKeyInput);
        const linkHint = document.createElement('div');
        linkHint.style.cssText = 'font-size:12px; color:#6c7086; margin-bottom:16px;';
        linkHint.innerHTML = 'Получить бесплатно: <a href="https://openrouter.ai/keys" target="_blank" style="color:#89b4fa;">openrouter.ai/keys</a>';
        settingsPanel.appendChild(linkHint);

        // --- Поле: Модель ---
        settingsPanel.appendChild(makeLabel('Модель'));
        const modelSelect = document.createElement('select');
        modelSelect.style.cssText = inputStyle();
        FREE_MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === getSetting('model')) opt.selected = true;
            modelSelect.appendChild(opt);
        });
        // Возможность ввести свою модель
        const customModelInput = makeInput('text', '', 'или введите свою модель...');
        customModelInput.style.marginBottom = '4px';
        settingsPanel.appendChild(modelSelect);
        settingsPanel.appendChild(customModelInput);
        const modelHint = document.createElement('div');
        modelHint.style.cssText = 'font-size:12px; color:#6c7086; margin-bottom:16px;';
        modelHint.textContent = 'Если введено своё значение — оно приоритетнее.';
        settingsPanel.appendChild(modelHint);

        // --- Поле: Промпт ---
        settingsPanel.appendChild(makeLabel('Системный промпт'));
        const promptArea = document.createElement('textarea');
        promptArea.value = getSetting('prompt');
        promptArea.rows = 4;
        promptArea.style.cssText = inputStyle() + 'resize:vertical; min-height:80px;';
        settingsPanel.appendChild(promptArea);
        const promptHint = document.createElement('div');
        promptHint.style.cssText = 'font-size:12px; color:#6c7086; margin-bottom:16px;';
        promptHint.textContent = 'Можно указать целевой язык, стиль и т.д.';
        settingsPanel.appendChild(promptHint);

        // --- Поле: Горячая клавиша ---
        settingsPanel.appendChild(makeLabel('Горячая клавиша'));
        const hotkeyInput = makeInput('text', getSetting('hotkey'), 'например: alt+a');
        settingsPanel.appendChild(hotkeyInput);
        const hotkeyHint = document.createElement('div');
        hotkeyHint.style.cssText = 'font-size:12px; color:#6c7086; margin-bottom:16px;';
        hotkeyHint.textContent = 'Формат: alt+a, ctrl+shift+t и т.д.';
        settingsPanel.appendChild(hotkeyHint);

        // --- Кнопки ---
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:12px; margin-top:8px;';

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '💾 Сохранить';
        saveBtn.style.cssText = btnStyle('#89b4fa', '#1e1e2e');
        saveBtn.onclick = () => {
            setSetting('apiKey', apiKeyInput.value.trim());
            const customModel = customModelInput.value.trim();
            setSetting('model', customModel || modelSelect.value);
            setSetting('prompt', promptArea.value.trim());
            setSetting('hotkey', hotkeyInput.value.trim().toLowerCase());
            showTooltip('✓ Настройки сохранены!', false);
            toggleSettings();
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Отмена';
        cancelBtn.style.cssText = btnStyle('#45475a', '#cdd6f4');
        cancelBtn.onclick = toggleSettings;

        const resetBtn = document.createElement('button');
        resetBtn.textContent = '🗑 Сброс';
        resetBtn.style.cssText = btnStyle('#f38ba8', '#1e1e2e');
        resetBtn.onclick = () => {
            if (confirm('Сбросить все настройки?')) {
                Object.keys(DEFAULTS).forEach(k => setSetting(k, DEFAULTS[k]));
                toggleSettings();
                showTooltip('Настройки сброшены', false);
            }
        };

        btnRow.appendChild(saveBtn);
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(resetBtn);
        settingsPanel.appendChild(btnRow);

        // Оверлей
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position:fixed; top:0; left:0; width:100%; height:100%;
            background:rgba(0,0,0,0.5); z-index:2147483646;
        `;
        overlay.onclick = toggleSettings;

        document.body.appendChild(overlay);
        document.body.appendChild(settingsPanel);
        settingsPanel._overlay = overlay;

        // Переопределяем toggleSettings для закрытия
        const origToggle = toggleSettings;
        toggleSettings = function () {
            if (settingsPanel) {
                settingsPanel._overlay?.remove();
                settingsPanel.remove();
                settingsPanel = null;
                toggleSettings = origToggle;
            }
        };
    }

    function makeLabel(text) {
        const l = document.createElement('label');
        l.textContent = text;
        l.style.cssText = 'display:block; margin-bottom:6px; font-weight:600; color:#a6adc8;';
        return l;
    }

    function inputStyle() {
        return `
            width:100%; padding:10px 12px; margin-bottom:12px;
            background:#313244; color:#cdd6f4; border:1px solid #45475a;
            border-radius:8px; font-size:14px; box-sizing:border-box;
            font-family: 'Segoe UI', system-ui, sans-serif;
            outline:none;
        `;
    }

    function makeInput(type, value, placeholder) {
        const inp = document.createElement('input');
        inp.type = type;
        inp.value = value;
        inp.placeholder = placeholder;
        inp.style.cssText = inputStyle();
        inp.onfocus = () => inp.style.borderColor = '#89b4fa';
        inp.onblur = () => inp.style.borderColor = '#45475a';
        return inp;
    }

    function btnStyle(bg, color) {
        return `
            padding:10px 18px; background:${bg}; color:${color};
            border:none; border-radius:8px; cursor:pointer;
            font-size:14px; font-weight:600;
            font-family: 'Segoe UI', system-ui, sans-serif;
        `;
    }

    // ======================== КНОПКА НАСТРОЕК ========================
    const gearBtn = document.createElement('button');
    gearBtn.textContent = '⚙';
    gearBtn.title = 'Настройки переводчика';
    gearBtn.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #313244;
        color: #cdd6f4;
        border: 1px solid #45475a;
        font-size: 22px;
        cursor: pointer;
        z-index: 2147483647;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
    `;
    gearBtn.onmouseenter = () => gearBtn.style.background = '#45475a';
    gearBtn.onmouseleave = () => gearBtn.style.background = '#313244';
    gearBtn.onclick = toggleSettings;
    document.body.appendChild(gearBtn);

    // ======================== ОБРАБОТКА ГОРЯЧЕЙ КЛАВИШИ ========================
    document.addEventListener('keydown', async function (e) {
        const hk = parseHotkey(getSetting('hotkey'));
        if (!matchesHotkey(e, hk)) return;

        e.preventDefault();
        e.stopPropagation();

        const active = document.activeElement;
        const isEditable =
            active &&
            (active.tagName === 'TEXTAREA' ||
                active.tagName === 'INPUT' ||
                active.isContentEditable);

        let text = '';

        if (isEditable) {
            // Перевод текста из поля ввода
            if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
                text = active.value;
            } else if (active.isContentEditable) {
                text = active.innerText;
            }

            if (!text.trim()) {
                showTooltip('Поле ввода пустое', true);
                return;
            }

            showLoading();
            try {
                const result = await translate(text);
                if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
                    active.value = result;
                } else {
                    active.innerText = result;
                }
                showTooltip('✓ Текст в поле заменён переводом', false);
            } catch (err) {
                showTooltip(String(err), true);
            }
        } else {
            // Перевод выделенного текста
            text = window.getSelection().toString().trim();

            if (!text) {
                showTooltip('Выделите текст для перевода', true);
                return;
            }

            showLoading();
            try {
                const result = await translate(text);
                showTooltip(result, false);
            } catch (err) {
                showTooltip(String(err), true);
            }
        }
    });
})();
