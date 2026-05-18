// === DOM Elements ===
const connectForm = document.getElementById('connect-form');
const connectionScreen = document.getElementById('connection-screen');
const dashboard = document.getElementById('dashboard');
const headerStatus = document.getElementById('header-status');
const headerBroker = document.getElementById('header-broker');
const logoutBtn = document.getElementById('logout-btn');
const video = document.getElementById('video');
const canvas = document.getElementById('overlay-canvas');
const ctx = canvas.getContext('2d');
const cvLoading = document.getElementById('cv-loading');
const modeRadios = document.querySelectorAll('input[name="mode"]');
const azimuthSlider = document.getElementById('azimuth-slider');
const elevationSlider = document.getElementById('elevation-slider');
const speedSlider = document.getElementById('speed-slider');
const stopBtn = document.getElementById('stop-btn');
const homeBtn = document.getElementById('home-btn');
const eventLog = document.getElementById('event-log');
const clearLogBtn = document.getElementById('clear-log');

// Telemetry DOM
const telAz = document.getElementById('tel-az');
const telEl = document.getElementById('tel-el');
const targetAz = document.getElementById('target-az');
const targetEl = document.getElementById('target-el');
const telStatus = document.getElementById('tel-status');
const telConf = document.getElementById('tel-conf');

// === State ===
let mqttClient = null;
let isAutoMode = false;
let faceApiLoaded = false;
let detectionInterval = null;
let trackingDeadzone = 0.02; // ~2% от центра кадра

// === Utils ===
function log(msg, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${msg}`;
    eventLog.prepend(entry);
    if (eventLog.children.length > 100) eventLog.lastChild.remove();
}
clearLogBtn.addEventListener('click', () => eventLog.innerHTML = '');

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

// === MQTT Connection ===
connectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = document.getElementById('broker-url').value.trim();
    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value.trim();

    log('Инициализация MQTT-клиента...');
    try {
        const url = new URL(rawUrl);
        const clientId = 'web_turret_' + Math.random().toString(36).substr(2, 9);
        mqttClient = new Paho.MQTT.Client(url.hostname, Number(url.port), url.pathname, clientId);

        mqttClient.onConnectionLost = (resp) => {
            log('Связь потеряна: ' + resp.errorMessage, 'error');
            headerStatus.textContent = 'OFFLINE';
            headerStatus.classList.remove('online');
        };

        mqttClient.onMessageArrived = handleIncomingMessage;

        mqttClient.connect({
            onSuccess: () => {
                mqttClient.subscribe('turret/telemetry', { qos: 1 });
                mqttClient.subscribe('cv/status', { qos: 1 });
                
                headerStatus.textContent = 'ONLINE';
                headerStatus.classList.add('online');
                headerBroker.textContent = rawUrl;
                connectionScreen.classList.add('hidden');
                dashboard.classList.remove('hidden');
                log('Успешно подключено к брокеру.', 'success');
                initCameraAndCV();
            },
            onFailure: (err) => {
                log('Ошибка подключения: ' + err.errorMessage, 'error');
            },
            userName: user || undefined,
            password: pass || undefined,
            useSSL: false,
            keepAliveInterval: 30,
            cleanSession: true
        });
    } catch (err) {
        log('Неверный формат URL. Используйте ws://адрес:порт/путь', 'error');
    }
});

logoutBtn.addEventListener('click', () => {
    if (mqttClient?.isConnected()) mqttClient.disconnect();
    dashboard.classList.add('hidden');
    connectionScreen.classList.remove('hidden');
    headerStatus.classList.remove('online');
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    if (detectionInterval) clearInterval(detectionInterval);
    log('Сессия завершена.');
});

// === Camera & Face API ===
async function initCameraAndCV() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
        await new Promise(res => video.onloadedmetadata = res);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        cvLoading.classList.remove('hidden');
        log('Загрузка моделей SSD MobileNetV1...');
        // ВНИМАНИЕ: Для работы требуется локальная папка /models с файлами весов face-api.js
        await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
        await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
        
        faceApiLoaded = true;
        cvLoading.classList.add('hidden');
        log('Модели CV успешно загружены.', 'success');
        startDetectionLoop();
    } catch (err) {
        log('Ошибка камеры/CV: ' + err.message, 'error');
        cvLoading.textContent = '❌ Доступ к камере или моделям запрещён.';
    }
}

function startDetectionLoop() {
    detectionInterval = setInterval(async () => {
        if (!faceApiLoaded || video.paused || video.readyState < 2) return;
        
        const detection = await faceapi.detectSingleFace(video, new faceapi.SsdMobilenetv1Options()).withFaceLandmarks();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (detection) {
            const { box, confidence } = detection.detection;
            const { x, y, width, height } = box;
            
            // Отрисовка bounding box
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, width, height);
            ctx.fillStyle = '#00ff88';
            ctx.font = 'bold 16px sans-serif';
            ctx.fillText(`Conf: ${(confidence * 100).toFixed(1)}%`, x, y - 8);

            telConf.textContent = (confidence * 100).toFixed(1);

            if (isAutoMode) performAutoTracking(x, y, width, height);
        } else {
            telConf.textContent = '0.0';
        }
    }, 200); // ~5 FPS для стабильности в браузере
}

// === Auto Tracking Logic ===
function performAutoTracking(boxX, boxY, boxW, boxH) {
    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;
    
    // Нормализованное смещение от центра (-0.5 до 0.5)
    const offsetX = (centerX - canvas.width / 2) / canvas.width;
    const offsetY = (centerY - canvas.height / 2) / canvas.height;

    if (Math.abs(offsetX) < trackingDeadzone && Math.abs(offsetY) < trackingDeadzone) return;

    const speed = parseInt(speedSlider.value) / 100;
    const maxStep = 25; // Максимальный шаг за тик (градусы)
    
    const currentAz = parseFloat(azimuthSlider.value);
    const currentEl = parseFloat(elevationSlider.value);

    const newAz = clamp(currentAz + (offsetX * maxStep * speed), 0, 180);
    const newEl = clamp(currentEl + (-offsetY * maxStep * speed), 0, 180); // Инверсия Y

    azimuthSlider.value = newAz.toFixed(1);
    elevationSlider.value = newEl.toFixed(1);
    
    // Обновляем UI значения
    document.getElementById('azimuth-val').textContent = newAz.toFixed(1);
    document.getElementById('elevation-val').textContent = newEl.toFixed(1);

    sendCommand('move', newAz, newEl, speedSlider.value);
}

// === UI Controls ===
modeRadios.forEach(r => r.addEventListener('change', (e) => {
    isAutoMode = e.target.value === 'auto';
    const manual = document.getElementById('manual-controls');
    manual.style.opacity = isAutoMode ? '0.4' : '1';
    manual.style.pointerEvents = isAutoMode ? 'none' : 'auto';
    log(`Режим: ${isAutoMode ? 'АВТОНАВЕДЕНИЕ' : 'РУЧНОЕ УПРАВЛЕНИЕ'}`, 'info');
}));

[azimuthSlider, elevationSlider, speedSlider].forEach(el => {
    el.addEventListener('input', () => {
        if (el === azimuthSlider) document.getElementById('azimuth-val').textContent = el.value;
        if (el === elevationSlider) document.getElementById('elevation-val').textContent = el.value;
        if (el === speedSlider) document.getElementById('speed-val').textContent = el.value;
    });
    el.addEventListener('change', () => {
        if (!isAutoMode && mqttClient?.isConnected()) {
            sendCommand('move', azimuthSlider.value, elevationSlider.value, speedSlider.value);
        }
    });
});

stopBtn.addEventListener('click', () => mqttClient?.isConnected() && sendCommand('stop'));
homeBtn.addEventListener('click', () => {
    if (!mqttClient?.isConnected()) return;
    sendCommand('home');
    azimuthSlider.value = 90; elevationSlider.value = 90; speedSlider.value = 50;
    document.getElementById('azimuth-val').textContent = '90';
    document.getElementById('elevation-val').textContent = '90';
    document.getElementById('speed-val').textContent = '50';
    log('Команда HOME отправлена.', 'success');
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
    mqttClient.send(msg);
    log(`➤ Команда: ${type} | Az: ${payload.targetAngles?.azimuth} El: ${payload.targetAngles?.elevation} Spd: ${payload.speed}%`);
}

function handleIncomingMessage(message) {
    const topic = message.destinationName;
    let payload;
    try { payload = JSON.parse(message.payloadString); } catch { return; }

    if (topic === 'turret/telemetry') {
        telAz.textContent = payload.currentAngles?.azimuth?.toFixed(1) || '-';
        telEl.textContent = payload.currentAngles?.elevation?.toFixed(1) || '-';
        targetAz.textContent = payload.targetAngles?.azimuth?.toFixed(1) || '-';
        targetEl.textContent = payload.targetAngles?.elevation?.toFixed(1) || '-';
        telStatus.textContent = payload.status || 'OK';
    } else if (topic === 'cv/status') {
        telConf.textContent = (payload.confidence * 100).toFixed(1) || '-';
    }
}