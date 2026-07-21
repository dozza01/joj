// ==UserScript==
// @name         Тестовый плагин
// @version      1.0.0
// @description  Просто выводит приветствие в консоль
// @match        *://*/*
// ==/UserScript==

console.log("Привет! Мой код работает и загружен динамически.");

// Тут будет твоя логика, например, создание кнопки в CRM
const btn = document.createElement('button');
btn.innerText = 'Тестовая кнопка из GitHub';
btn.style.position = 'fixed';
btn.style.bottom = '20px';
btn.style.right = '20px';
btn.style.zIndex = '9999';
document.body.appendChild(btn);
