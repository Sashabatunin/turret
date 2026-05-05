// ========== CONFIGURATION ==========
// --- HiveMQ Cloud broker (WebSocket) ---
const MQTT_HOST = '367d7905056a451cac7755db6f5bcc81.s1.eu.hivemq.cloud';
const MQTT_PORT = 8884;           // WebSocket TLS port – check your dashboard!
const MQTT_PATH = '/mqtt';        // HiveMQ Cloud WebSocket path
const MQTT_USER = 'johner';
const MQTT_PASS = 'John000111';
const MQTT_TOPIC = 'turret/angles';

// --- Tracking parameters ---
const KP = 0.05;                  // proportional gain for servo movement
const SEND_INTERVAL = 100;        // ms between sent tracking messages

// ========== GLOBAL STATE ==========
let video, overlay, ctx;
let trackingMode = 'none';        // 'none', 'face', 'custom'
let mqttClient = null;
let sendTimer = null;
let lastSentData = { dx: 0, dy: 0 };

// For custom tracking (colour based)
let selectionActive = false;
let selectionRect = null;         // { x, y, w, h } – normalised to video size
let targetColor = null;           // [R, G, B] average colour of selection

// UI elements
const statusDiv = document.getElementById('status');
const mqttStateDiv = document.getElementById('mqtt-state');
const btnFace = document.getElementById('btnFace');
const btnCustom = document.getElementById('btnCustom');
const btnStop = document.getElementById('btnStop');

// ========== INIT ==========
async function init() {
  video = document.getElementById('video');
  overlay = document.getElementById('overlay');
  ctx = overlay.getContext('2d');

  // 1. Get webcam stream
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
    statusDiv.textContent = 'Camera ready. Load models…';
  } catch (err) {
    statusDiv.textContent = 'Camera error: ' + err.message;
    console.error(err);
    return;
  }

  // 2. Load face‑api models
  try {
    await faceapi.nets.tinyFaceDetector.load('turret/models');
    await faceapi.nets.faceLandmark68TinyNet.load('turret/models'); // may be optional, but we load it
    statusDiv.textContent = 'Face models loaded. Connecting MQTT…';
    btnFace.disabled = false;
    btnCustom.disabled = false;
  } catch (err) {
    statusDiv.textContent = 'Model load error: ' + err.message;
    console.error(err);
    return;
  }

  // 3. Connect MQTT
  connectMQTT();
}

// ========== MQTT ==========
function connectMQTT() {
  // Build the WebSocket URL
  const wsUrl = `wss://${MQTT_HOST}:${MQTT_PORT}${MQTT_PATH}`;
  mqttStateDiv.textContent = 'MQTT: connecting...';

  mqttClient = mqtt.connect(wsUrl, {
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: 'turret_web_' + Math.random().toString(16).substr(2, 8),
    keepalive: 60,
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000,
  });

  mqttClient.on('connect', () => {
    mqttStateDiv.textContent = 'MQTT: connected';
    console.log('MQTT connected');
    btnStop.disabled = false; // enable stop once we have a connection
  });

  mqttClient.on('error', (err) => {
    mqttStateDiv.textContent = 'MQTT error: ' + err.message;
    console.error('MQTT error:', err);
  });

  mqttClient.on('close', () => {
    mqttStateDiv.textContent = 'MQTT: disconnected';
    console.log('MQTT closed');
  });
}

// Send dx, dy to the ESP32
function sendTrackingData(dx, dy) {
  if (!mqttClient || !mqttClient.connected) return;
  // Only send if data changed significantly (optional)
  if (Math.abs(dx - lastSentData.dx) < 1 && Math.abs(dy - lastSentData.dy) < 1) return;
  lastSentData = { dx, dy };
  const payload = JSON.stringify({ dx, dy, kp: KP });
  mqttClient.publish(MQTT_TOPIC, payload);
  console.log('Sent:', payload);
}

// Start periodic sending
function startSendLoop() {
  stopSendLoop();
  sendTimer = setInterval(() => {
    // actual send happens inside the tracking loop via sendTrackingData
    // this interval ensures we send at a constant rate, even if detection is slower
    // we store the latest dx/dy from the last detection
  }, SEND_INTERVAL);
}

function stopSendLoop() {
  if (sendTimer) {
    clearInterval(sendTimer);
    sendTimer = null;
  }
}

// ========== FACE TRACKING ==========
async function faceTrackingLoop() {
  if (trackingMode !== 'face') return;

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    // Overlay dimensions must match video
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const result = await faceapi.detectSingleFace(video, options);

    // Clear overlay
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (result) {
      const box = result.box;
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const dx = centerX - overlay.width / 2;
      const dy = centerY - overlay.height / 2;

      // Draw bounding box for feedback
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x, box.y, box.width, box.height);
      ctx.fillStyle = '#00ff00';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
      ctx.fill();

      sendTrackingData(dx, dy);
    }
  }

  requestAnimationFrame(() => faceTrackingLoop());
}

// ========== CUSTOM (COLOUR) TRACKING ==========
function customTrackingLoop() {
  if (trackingMode !== 'custom') return;

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;

    // Draw the current frame onto the canvas to process pixels
    ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
    const imageData = ctx.getImageData(0, 0, overlay.width, overlay.height);
    const pixels = imageData.data;

    // If we have a target colour, find the centroid of pixels within threshold
    if (targetColor) {
      const centroid = computeColorCentroid(pixels, overlay.width, overlay.height, targetColor, 80);
      if (centroid) {
        const dx = centroid.x - overlay.width / 2;
        const dy = centroid.y - overlay.height / 2;

        // Visual feedback: draw a marker
        ctx.fillStyle = '#ff0000';
        ctx.beginPath();
        ctx.arc(centroid.x, centroid.y, 8, 0, 2 * Math.PI);
        ctx.fill();

        sendTrackingData(dx, dy);
      } else {
        // Target lost – maybe flash a warning
      }
    } else {
      // Still waiting for user selection – show instruction
      ctx.font = '24px Arial';
      ctx.fillStyle = 'white';
      ctx.fillText('Draw a box around the object', 20, 50);
    }
  }

  requestAnimationFrame(() => customTrackingLoop());
}

// Find the weighted centroid of all pixels similar to targetColor
function computeColorCentroid(pixels, w, h, targetRgb, threshold) {
  let sumX = 0, sumY = 0, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      // Euclidean distance in RGB space
      const dr = r - targetRgb[0];
      const dg = g - targetRgb[1];
      const db = b - targetRgb[2];
      const dist = Math.sqrt(dr*dr + dg*dg + db*db);
      if (dist < threshold) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

// ========== DRAWING BOX FOR CUSTOM SELECTION ==========
function enableCustomSelection() {
  if (trackingMode !== 'none') return;
  trackingMode = 'custom'; // will start loop when user finishes drawing

  let startX, startY;
  let drawing = false;

  function handleMouseDown(e) {
    const rect = overlay.getBoundingClientRect();
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    startX = (e.clientX - rect.left) * scaleX;
    startY = (e.clientY - rect.top) * scaleY;
    drawing = true;
  }

  function handleMouseMove(e) {
    if (!drawing) return;
    const rect = overlay.getBoundingClientRect();
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    const currentX = (e.clientX - rect.left) * scaleX;
    const currentY = (e.clientY - rect.top) * scaleY;

    // Draw rubber band box
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.drawImage(video, 0, 0, overlay.width, overlay.height);
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, currentX - startX, currentY - startY);
  }

  function handleMouseUp(e) {
    if (!drawing) return;
    drawing = false;
    const rect = overlay.getBoundingClientRect();
    const scaleX = overlay.width / rect.width;
    const scaleY = overlay.height / rect.height;
    const endX = (e.clientX - rect.left) * scaleX;
    const endY = (e.clientY - rect.top) * scaleY;

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    if (w < 10 || h < 10) {
      alert('Draw a larger box');
      cleanup();
      enableCustomSelection(); // restart selection mode
      return;
    }

    selectionRect = { x, y, w, h };

    // Extract average colour inside the box
    const imageData = ctx.getImageData(x, y, w, h);
    const avg = averageColor(imageData.data);
    targetColor = avg;
    console.log('Target colour RGB:', avg);

    // Remove listeners
    cleanup();
    // Start tracking loop
    startCustomTrackingLoop();
  }

  function cleanup() {
    overlay.removeEventListener('mousedown', handleMouseDown);
    overlay.removeEventListener('mousemove', handleMouseMove);
    overlay.removeEventListener('mouseup', handleMouseUp);
  }

  overlay.addEventListener('mousedown', handleMouseDown);
  overlay.addEventListener('mousemove', handleMouseMove);
  overlay.addEventListener('mouseup', handleMouseUp);

  statusDiv.textContent = 'Draw a box around the object';
}

function averageColor(pixelArray) {
  let r = 0, g = 0, b = 0, count = pixelArray.length / 4;
  for (let i = 0; i < pixelArray.length; i += 4) {
    r += pixelArray[i];
    g += pixelArray[i + 1];
    b += pixelArray[i + 2];
  }
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function startCustomTrackingLoop() {
  statusDiv.textContent = 'Custom tracking active';
  btnCustom.disabled = true;
  btnFace.disabled = true;
  btnStop.disabled = false;
  customTrackingLoop(); // start the requestAnimationFrame loop
}

// ========== BUTTON HANDLERS ==========
btnFace.addEventListener('click', () => {
  if (trackingMode !== 'none') return;
  trackingMode = 'face';
  btnFace.disabled = true;
  btnCustom.disabled = true;
  btnStop.disabled = false;
  statusDiv.textContent = 'Face tracking active';
  faceTrackingLoop();
});

btnCustom.addEventListener('click', () => {
  if (trackingMode !== 'none') return;
  // Enter selection mode, then tracking
  enableCustomSelection();
});

btnStop.addEventListener('click', () => {
  trackingMode = 'none';
  btnFace.disabled = false;
  btnCustom.disabled = false;
  btnStop.disabled = true;
  statusDiv.textContent = 'Tracking stopped';
  // The tracking loops will stop because trackingMode check fails
  ctx.clearRect(0, 0, overlay.width, overlay.height);
});

// ========== START EVERYTHING ==========
init();
