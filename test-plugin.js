// ==UserScript==
// @name         Тестовая кнопка Pro
// @version      1.1.0
// @description  Кнопка с сохранением позиции и счетчиком кликов
// @match        *://*/*
// ==/UserScript==

(function() {
  'use strict';

  // Инициализация хранилища (если доступно через Script Hub)
  const storage = window.scriptStorage || {
    get: async (key) => localStorage.getItem(`sh_${key}`),
    set: async (data) => {
      for (let [key, value] of Object.entries(data)) {
        localStorage.setItem(`sh_${key}`, value);
      }
    }
  };

  // Загружаем сохраненные данные
  let clickCount = parseInt(await storage.get('clickCount')) || 0;
  let btnPosition = JSON.parse(await storage.get('btnPosition')) || { bottom: 20, right: 20 };

  // Создаем кнопку
  const btn = document.createElement('button');
  btn.id = 'script-hub-test-btn';
  btn.textContent = `🚀 Кликов: ${clickCount}`;
  btn.style.cssText = `
    position: fixed;
    bottom: ${btnPosition.bottom}px;
    right: ${btnPosition.right}px;
    z-index: 999999;
    padding: 12px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 25px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    transition: all 0.3s ease;
    user-select: none;
  `;

  // Обработчик клика
  btn.addEventListener('click', async () => {
    clickCount++;
    btn.textContent = `🚀 Кликов: ${clickCount}`;
    await storage.set({ clickCount: clickCount.toString() });
    
    // Визуальный фидбек
    btn.style.transform = 'scale(0.95)';
    setTimeout(() => btn.style.transform = 'scale(1)', 100);
  });

  // Делаем кнопку перетаскиваемой
  let isDragging = false;
  let startX, startY, initialX, initialY;

  btn.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    initialX = btn.offsetLeft;
    initialY = btn.offsetTop;
    btn.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', async (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    btn.style.left = `${initialX + dx}px`;
    btn.style.top = `${initialY + dy}px`;
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', async () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.cursor = 'pointer';
    
    // Сохраняем новую позицию
    const rect = btn.getBoundingClientRect();
    await storage.set({
      btnPosition: JSON.stringify({
        bottom: window.innerHeight - rect.bottom,
        right: window.innerWidth - rect.right
      })
    });
  });

  document.body.appendChild(btn);
  console.log('[Script Hub Pro] Кнопка с сохранением состояния активирована');
})();
