'use strict';

// Ждем полной загрузки DOM перед инициализацией
document.addEventListener('DOMContentLoaded', () => {
    // === DOM Elements ===
    const els = {
        form: document.getElementById('connect-form'),
        connectBtn: document.getElementById('connect-btn'),
        screen: document.getElementById('connection-screen'),
        dashboard: document.getElementById('dashboard'),
        status: document.getElementById('header-status'),
        broker: document.getElementById('header-broker'),
        logout: document.getElementById('logout-btn'),
        video: document.getElementById('video'),
        canvas: document.getElementById('overlay-canvas'),
        ctx: document.getElementById('overlay-canvas').getContext('2d'),
        cvLoading: document.getElementById('cv-loading'),
        jsError: document.getElementById('js-error'),
        modeRadios: document.querySelectorAll('input[name="mode"]'),
        azSlider: document.getElementById('azimuth-slider'),
        elSlider: document.getElementById('elevation-slider'),
        speedSlider: document.getElementById('speed-slider'),
        azVal: document.getElementById('azimuth-val'),
        elVal: document.getElementById('elevation-val'),
        speedVal: document.getElementById('speed-val'),
        stopBtn: document.getElementById('stop-btn'),
        homeBtn: document.getElementById('home-btn'),
        log: document.getElementById('event-log'),
        clearLog: document.getElementById('clear-log'),
        tel: {
            az: document.getElementById('tel-az'),
            el: document.getElementById('tel-el'),
            tAz: document.getElementById('target-az'),
            tEl: document.getElementById('target-el'),
            status: document.getElementById('tel-status'),
            conf: document.getElementById('tel-conf')
        }
    };

    // === State ===
    const state = {
        client: null,
        connectOptions: null,
        autoMode: false,
        faceApiReady: false,
        detectionInterval: null,
        lastCmdTime: 0,
        cmdThrottle: 350, // Защита от бана брокера (мс)
        reconnectTimer: null,
        isConnecting: false
    };

    // === Logger ===
    function log(msg, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        els.log.prepend(entry);
        if (els.log.children.length > 100) els.log.lastChild.remove();
        
        // Дублируем в консоль для отладки
        if (type === 'error') console.error(`[MQTT/UI] ${msg}`);
        else console.log(`[MQTT/UI] ${msg}`);
    }

    // === Global Error Handler ===
    window.addEventListener('error', (e) => {
        els.jsError.classList.remove('hidden');
        els.jsError.textContent = `❌ Критическая ошибка: ${e.message}`;
        console.error('Global error:', e.error);
    });
    els.clearLog.addEventListener('click', () => els.log.innerHTML = '');

    // === Helpers ===
    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
    function toggleConnectUI(loading, text) {
        state.isConnecting = loading;
        els.connectBtn.disabled = loading;
        els.connectBtn.textContent = text;
        if (loading) els.connectBtn.classList.add('loading');
        else els.connectBtn.classList.remove('loading');
    }

    // === MQTT Connection ===
    els.form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (state.isConnecting) return;

        const rawUrl = document.getElementById('broker-url').value.trim();
        const user = document.getElementById('username').value.trim();
        const pass = document.getElementById('password').value.trim();

        try {
            const url = new URL(rawUrl);
            const isSecure = url.protocol === 'wss:';
            const port = Number(url.port) || (isSecure ? 443 : 80);
            const path = url.pathname || '/';
            const clientId = `web_turret_${Math.random().toString(36).substr(2, 9)}`;

            toggleConnectUI(true, 'Подключение...');
            log(`Инициализация клиента (${clientId})...`);

            state.client = new Paho.MQTT.Client(url.hostname, port, path, clientId);
            state.client.onConnectionLost = (resp) => handleDisconnect(resp.errorMessage);
            state.client.onMessageArrived = handleMessage;

            state.connectOptions = {
                userName: user || undefined,
                password: pass || undefined,
                useSSL: isSecure,
                keepAliveInterval: 30,
                cleanSession: true,
                onSuccess: () => handleConnectSuccess(rawUrl),
                onFailure: (err) => handleConnectFail(err.errorMessage)
            };

            state.client.connect(state.connectOptions);
        } catch (err) {
            log(`Ошибка URL: ${err.message}`, 'error');
            toggleConnectUI(false, 'Подключиться');
        }
    });

    function handleConnectSuccess(urlStr) {
        toggleConnectUI(false, 'Подключиться');
        state.client.subscribe('turret/telemetry', { qos: 1 });
        state.client.subscribe('cv/status', { qos: 1 });
        
        els.status.textContent = 'ONLINE';
        els.status.classList.add('online');
        els.broker.textContent = urlStr;
        els.screen.classList.add('hidden');
        els.dashboard.classList.remove('hidden');
        
        log('Успешно подключено. Запуск камеры...', 'success');
        initCameraAndCV();
    }

    function handleConnectFail(errMsg) {
        log(`Отказ брокера: ${errMsg}`, 'error');
        toggleConnectUI(false, 'Подключиться');
        els.status.textContent = 'OFFLINE';
        els.status.classList.remove('online');
    }

    function handleDisconnect(errMsg) {
        log(`Связь потеряна: ${errMsg}`, 'error');
        els.status.textContent = 'OFFLINE';
        els.status.classList.remove('online');
        
        if (!state.reconnectTimer) {
            log('Попытка переподключения через 5 сек...', 'info');
            state.reconnectTimer = setTimeout(() => {
                state.reconnectTimer = null;
                if (state.client && state.connectOptions) {
                    state.client.connect(state.connectOptions);
                }
            }, 5000);
        }
    }

    // === Camera & CV ===
    async function initCameraAndCV() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } 
            });
            els.video.srcObject = stream;
            await new Promise(res => els.video.onloadedmetadata = res);
            await els.video.play();
            
            els.canvas.width = els.video.videoWidth;
            els.canvas.height = els.video.videoHeight;

            els.cvLoading.classList.remove('hidden');
            log('Загрузка моделей face-api.js...');
            
            // Требуется локальный сервер! file:// не работает
            await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
            
            state.faceApiReady = true;
            els.cvLoading.classList.add('hidden');
            log('Модели CV загружены.', 'success');
            startDetectionLoop();
        } catch (err) {
            log(`Ошибка камеры/CV: ${err.message}. Убедитесь, что используете http://localhost`, 'error');
            els.cvLoading.textContent = '❌ Доступ запрещён. Запустите локальный сервер.';
        }
    }

    function startDetectionLoop() {
        state.detectionInterval = setInterval(async () => {
            if (!state.faceApiReady || els.video.paused || els.video.readyState < 4) return;
            
            try {
                const detection = await faceapi.detectSingleFace(els.video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }));
                els.ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

                if (detection) {
                    const { box, confidence } = detection.detection;
                    const { x, y, width, height } = box;
                    
                    els.ctx.strokeStyle = '#00ff88';
                    els.ctx.lineWidth = 2;
                    els.ctx.strokeRect(x, y, width, height);
                    els.ctx.fillStyle = '#00ff88';
                    els.ctx.font = 'bold 14px sans-serif';
                    els.ctx.fillText(`Conf: ${(confidence * 100).toFixed(1)}%`, x, y - 5);

                    els.tel.conf.textContent = (confidence * 100).toFixed(1);
                    if (state.autoMode) performAutoTracking(x, y, width, height);
                } else {
                    els.tel.conf.textContent = '0.0';
                }
            } catch (err) {
                log(`Ошибка детекции: ${err.message}`, 'error');
            }
        }, 200);
    }

    // === Auto Tracking ===
    function performAutoTracking(boxX, boxY, boxW, boxH) {
        const now = Date.now();
        if (now - state.lastCmdTime < state.cmdThrottle) return;

        const centerX = boxX + boxW / 2;
        const centerY = boxY + boxH / 2;
        const offsetX = (centerX - els.canvas.width / 2) / els.canvas.width;
        const offsetY = (centerY - els.canvas.height / 2) / els.canvas.height;
        const deadzone = 0.03; // ~3%

        if (Math.abs(offsetX) < deadzone && Math.abs(offsetY) < deadzone) return;

        state.lastCmdTime = now;
        const speed = parseInt(els.speedSlider.value) / 100;
        const maxStep = 20;
        
        const currentAz = parseFloat(els.azSlider.value);
        const currentEl = parseFloat(els.elSlider.value);

        const newAz = clamp(currentAz + (offsetX * maxStep * speed), 0, 180);
        const newEl = clamp(currentEl + (-offsetY * maxStep * speed), 0, 180);

        els.azSlider.value = newAz.toFixed(1);
        els.elSlider.value = newEl.toFixed(1);
        els.azVal.textContent = newAz.toFixed(1);
        els.elVal.textContent = newEl.toFixed(1);

        sendCommand('move', newAz, newEl, els.speedSlider.value);
    }

    // === UI Controls ===
    els.modeRadios.forEach(r => r.addEventListener('change', (e) => {
        state.autoMode = e.target.value === 'auto';
        const manual = document.getElementById('manual-controls');
        manual.style.opacity = state.autoMode ? '0.4' : '1';
        manual.style.pointerEvents = state.autoMode ? 'none' : 'auto';
        log(`Режим: ${state.autoMode ? 'АВТОНАВЕДЕНИЕ' : 'РУЧНОЕ УПРАВЛЕНИЕ'}`, 'info');
    }));

    [els.azSlider, els.elSlider, els.speedSlider].forEach(el => {
        el.addEventListener('input', () => {
            if (el === els.azSlider) els.azVal.textContent = el.value;
            if (el === els.elSlider) els.elVal.textContent = el.value;
            if (el === els.speedSlider) els.speedVal.textContent = el.value;
        });
        el.addEventListener('change', () => {
            if (!state.autoMode && state.client?.isConnected()) {
                sendCommand('move', els.azSlider.value, els.elSlider.value, els.speedSlider.value);
            }
        });
    });

    els.stopBtn.addEventListener('click', () => state.client?.isConnected() && sendCommand('stop'));
    els.homeBtn.addEventListener('click', () => {
        if (!state.client?.isConnected()) return;
        sendCommand('home');
        els.azSlider.value = 90; els.elSlider.value = 90; els.speedSlider.value = 50;
        els.azVal.textContent = '90'; els.elVal.textContent = '90'; els.speedVal.textContent = '50';
        log('Команда HOME отправлена.', 'success');
    });

    els.logout.addEventListener('click', () => {
        if (state.client?.isConnected()) state.client.disconnect();
        els.dashboard.classList.add('hidden');
        els.screen.classList.remove('hidden');
        els.status.classList.remove('online');
        if (els.video.srcObject) els.video.srcObject.getTracks().forEach(t => t.stop());
        if (state.detectionInterval) clearInterval(state.detectionInterval);
        log('Сессия завершена.');
    });

    // === MQTT Messaging ===
    function sendCommand(type, az = null, el = null, spd = null) {
        const payload = { type, timestamp: Date.now() };
        if (type === 'move') {
            payload.targetAngles = { azimuth: parseFloat(az), elevation: parseFloat(el) };
            payload.speed = parseInt(spd);
        }
        const msg = new Paho.MQTT.Message(JSON.stringify(payload));
        msg.destinationName = 'turret/cmd';
        state.client.send(msg);
        log(`➤ Команда: ${type} | Az: ${payload.targetAngles?.azimuth ?? '-'} El: ${payload.targetAngles?.elevation ?? '-'} Spd: ${payload.speed ?? '-'}%`);
    }

    function handleMessage(message) {
        const topic = message.destinationName;
        let payload;
        try { payload = JSON.parse(message.payloadString); } catch { return; }

        if (topic === 'turret/telemetry') {
            els.tel.az.textContent = payload.currentAngles?.azimuth?.toFixed(1) ?? '-';
            els.tel.el.textContent = payload.currentAngles?.elevation?.toFixed(1) ?? '-';
            els.tel.tAz.textContent = payload.targetAngles?.azimuth?.toFixed(1) ?? '-';
            els.tel.tEl.textContent = payload.targetAngles?.elevation?.toFixed(1) ?? '-';
            els.tel.status.textContent = payload.status || 'OK';
        } else if (topic === 'cv/status') {
            els.tel.conf.textContent = (payload.confidence * 100).toFixed(1) ?? '-';
        }
    }
});