// ==UserScript==
// @name         Круглая кнопка
// @namespace    http://tampermonkey.net/
// @version      11
// @description  Добавляет круглую кнопку в левый верхний угол, которая ничего не делает.
// @author       You
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Создаем элемент кнопки
    const button = document.createElement('button');

    // Стили для кнопки (круглая, закреплена в левом верхнем углу)
    button.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background-color: #007bff;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        z-index: 999999;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s;
    `;

    // Добавляем простой символ внутрь кнопки
    button.innerHTML = '•';

    // Обработчик клика, который ничего не делает
    button.addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        // Ничего не делаем
    });

    // Эффект при наведении (небольшое изменение цвета)
    button.addEventListener('mouseenter', function() {
        this.style.backgroundColor = '#0056b3';
    });
    button.addEventListener('mouseleave', function() {
        this.style.backgroundColor = '#007bff';
    });

    // Добавляем кнопку на страницу
    document.body.appendChild(button);
})();
