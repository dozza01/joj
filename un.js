// ==UserScript==
// @name         UnicoNotion
// @version      2.9.1
// @description  Скрипт,который позволяет ставить напоминание на клиента через определенное время.
// @author       Ебейший 77
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @license MIT
// @namespace https://greasyfork.org/users/1338837
// @downloadURL https://update.greasyfork.org/scripts/502630/UnicoNotion.user.js
// @updateURL https://update.greasyfork.org/scripts/502630/UnicoNotion.meta.js
// ==/UserScript==

(function() {
    'use strict';

    const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/PoopSoftWare/UnicoNotion/main/upd';
    const GITHUB_SCRIPT_URL = 'https://update.greasyfork.org/scripts/502630/UnicoNotion.user.js';
    const CURRENT_VERSION = '2.9.1';

    function createButton(text, styles) {
        const button = document.createElement('button');
        button.textContent = text;
        Object.assign(button.style, styles, {
            position: 'fixed',
            zIndex: 1000,
            cursor: 'pointer',
        });
        return button;
    }

    const reminderButton = createButton('+', {
        bottom: '10vh',
        left: '1vw',
        width: '60px',
        height: '60px',
        backgroundColor: '#808080',
        color: 'white',
        border: 'none',
        borderRadius: '50%',
        fontSize: '24px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
    });

    document.body.appendChild(reminderButton);

    const formContainer = createFormContainer();
    document.body.appendChild(formContainer);

    const listContainer = createListContainer();
    document.body.appendChild(listContainer);

    const audio = new Audio('https://www.soundjay.com/buttons/sounds/button-7.mp3');

    reminderButton.addEventListener('click', () => formContainer.style.display = 'block');

    document.getElementById('closeForm').addEventListener('click', () => formContainer.style.display = 'none');
    document.getElementById('saveReminder').addEventListener('click', saveReminder);
    document.getElementById('showList').addEventListener('click', showRemindersList);

    function createFormContainer() {
        const container = document.createElement('div');
        Object.assign(container.style, {
            display: 'none',
            position: 'fixed',
            top: '20vh',
            left: '2vw',
            zIndex: 1001,
            backgroundColor: 'white',
            padding: '20px',
            border: '1px solid #ddd',
            boxShadow: '0 0 10px rgba(0,0,0,0.1)',
            borderRadius: '8px',
            width: '300px',
        });
        container.innerHTML = `
            <h3>Добавить напоминание</h3>
            <label>ID Лида:</label>
            <input type="text" id="clientId" style="width: 100%; margin-bottom: 10px;">
            <label>Текст напоминания:</label>
            <input type="text" id="reminderText" style="width: 100%; margin-bottom: 10px;">
            <label>Через сколько минут напомнить:</label>
            <input type="number" id="reminderTime" style="width: 100%; margin-bottom: 10px;">
            <button id="saveReminder" style="width: 100%;">Сохранить</button>
            <button id="showList" style="width: 100%; margin-top: 10px;">Список напоминаний</button>
            <button id="closeForm" style="width: 100%; margin-top: 10px;">Закрыть</button>
        `;
        return container;
    }

    function createListContainer() {
        const container = document.createElement('div');
        Object.assign(container.style, {
            display: 'none',
            position: 'fixed',
            top: '20vh',
            left: '2vw',
            zIndex: 1001,
            backgroundColor: 'white',
            padding: '20px',
            border: '1px solid #ddd',
            boxShadow: '0 0 10px rgba(0,0,0,0.1)',
            borderRadius: '8px',
            width: '400px',
            maxHeight: '60vh',
            overflowY: 'auto',
        });
        container.innerHTML = `
            <h3>Список напоминаний</h3>
            <div id="remindersList"></div>
            <button id="closeList" style="width: 100%; margin-top: 10px;">Закрыть</button>
        `;
        container.querySelector('#closeList').addEventListener('click', () => {
            container.style.display = 'none';
            formContainer.style.display = 'block';
        });
        return container;
    }

    function saveReminder() {
        const clientId = document.getElementById('clientId').value;
        const reminderText = document.getElementById('reminderText').value;
        const reminderTime = parseInt(document.getElementById('reminderTime').value);

        if (!clientId || !reminderText || isNaN(reminderTime)) {
            alert('Заполните все поля');
            return;
        }

        const now = new Date();
        const reminder = {
            clientId,
            reminderText,
            reminderTime,
            reminderTimestamp: now.getTime() + reminderTime * 60000
        };

        let reminders = JSON.parse(localStorage.getItem('reminders')) || [];
        reminders.push(reminder);
        localStorage.setItem('reminders', JSON.stringify(reminders));

        alert('Напоминание сохранено');

        // Clear input fields after saving
        document.getElementById('clientId').value = '';
        document.getElementById('reminderText').value = '';
        document.getElementById('reminderTime').value = '';
    }

    function showRemindersList() {
        const reminders = JSON.parse(localStorage.getItem('reminders')) || [];
        const listElement = document.getElementById('remindersList');
        listElement.innerHTML = '';

        reminders.forEach((reminder, index) => {
            const reminderTime = new Date(reminder.reminderTimestamp);
            const formattedTime = formatMoscowTime(reminderTime);

            const reminderItem = document.createElement('div');
            reminderItem.innerHTML = `
                <p><strong>Лид:</strong> ${reminder.clientId}</p>
                <p><strong>Напоминание:</strong> ${reminder.reminderText}</p>
                <p><strong>Время (МСК):</strong> ${formattedTime}</p>
                <button onclick="deleteReminder(${index})">Удалить</button>
                <hr>
            `;
            listElement.appendChild(reminderItem);
        });

        formContainer.style.display = 'none';
        listContainer.style.display = 'block';
    }

    function formatMoscowTime(date) {
        const moscowOffset = 3 * 60; // Moscow is UTC+3
        const userOffset = -date.getTimezoneOffset();
        const offsetDiff = moscowOffset - userOffset;

        const moscowDate = new Date(date.getTime() + offsetDiff * 60000);

        return moscowDate.toLocaleString('ru-RU', {
            timeZone: 'Europe/Moscow',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }

    function deleteReminder(index) {
        let reminders = JSON.parse(localStorage.getItem('reminders')) || [];
        reminders.splice(index, 1);
        localStorage.setItem('reminders', JSON.stringify(reminders));
        showRemindersList();
    }

    function checkReminders() {
        let reminders = JSON.parse(localStorage.getItem('reminders')) || [];
        const now = Date.now();

        reminders = reminders.filter(reminder => {
            if (now >= reminder.reminderTimestamp) {
                audio.play();
                alert(`Напоминание: ${reminder.clientId}: ${reminder.reminderText}`);
                return false;
            }
            return true;
        });

        localStorage.setItem('reminders', JSON.stringify(reminders));
    }

    function checkForUpdates() {
        GM_xmlhttpRequest({
            method: 'GET',
            url: GITHUB_VERSION_URL,
            onload: function(response) {
                const latestVersion = response.responseText.trim();
                if (latestVersion > CURRENT_VERSION) {
                    if (confirm(`Доступна новая версия (${latestVersion}). Обновить сейчас?`)) {
                        window.location.href = GITHUB_SCRIPT_URL;
                    }
                }
            }
        });
    }

    setInterval(checkReminders, 60000);
    checkReminders();
    checkForUpdates();


    unsafeWindow.deleteReminder = deleteReminder;
})();
