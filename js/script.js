const video = document.getElementById('video');
const startBtn = document.getElementById('start-btn');
const status = document.getElementById('status');

// 🔧 Настройте этот путь под вашу структуру!
// Для CDN: 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js-models@master'
const MODEL_URL = '/models';

let modelsLoaded = false;

// 📦 Загрузка моделей с прогрессом
async function loadModels() {
  try {
    status.textContent = '📦 Загрузка детектора лиц...';
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    
    status.textContent = '📦 Загрузка ключевых точек...';
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
    
    // Опциональные модели (раскомментируйте если нужны)
    // status.textContent = '📦 Загрузка распознавания...';
    // await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    
    status.textContent = '📦 Загрузка выражений лица...';
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);
    
    status.textContent = '📦 Загрузка возраста/пола...';
    await faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL);
    
    modelsLoaded = true;
    status.textContent = '✅ Модели загружены!';
    status.className = 'success';
    
    // 🔓 Активируем кнопку только после загрузки моделей
    startBtn.disabled = false;
    
  } catch (err) {
    console.error('❌ Ошибка загрузки моделей:', err);
    status.textContent = `❌ Ошибка моделей: ${err.message}`;
    status.className = 'error';
    
    // 💡 Подсказка про CORS
    if (err.message.includes('Failed to fetch')) {
      status.textContent += '\n💡 Проверьте: запущен ли сервер? Правильный ли путь к моделям?';
    }
  }
}

// 🎥 Запуск камеры (только по клику!)
async function startCamera() {
  if (!modelsLoaded) {
    status.textContent = '⏳ Сначала дождитесь загрузки моделей!';
    return;
  }
  
  startBtn.disabled = true;
  status.textContent = '🎥 Запрос доступа к камере...';
  
  try {
    // 🔑 Ключевые настройки для совместимости
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 720 },
        height: { ideal: 560 },
        facingMode: 'user' // Фронтальная камера на мобильных
      },
      audio: false
    });
    
    video.srcObject = stream;
    status.textContent = '✅ Камера подключена!';
    status.className = 'success';
    
    // 🎬 Ждём готовности видео перед запуском детекции
    video.onloadedmetadata = () => {
      video.play().then(() => {
        startFaceDetection();
      }).catch(playErr => {
        console.error('❌ Ошибка воспроизведения:', playErr);
        status.textContent = `❌ Не удалось запустить видео: ${playErr.message}`;
        status.className = 'error';
      });
    };
    
  } catch (err) {
    console.error('❌ Ошибка доступа к камере:', err);
    
    // 🎯 Детальная обработка ошибок [[10]][[17]]
    if (err.name === 'NotAllowedError') {
      status.textContent = '🚫 Доступ к камере запрещён. Проверьте настройки браузера.';
    } else if (err.name === 'NotFoundError') {
      status.textContent = '🔍 Камера не найдена. Подключите веб-камеру.';
    } else if (err.name === 'NotReadableError') {
      status.textContent = '⚠️ Камера занята другим приложением.';
    } else if (err.name === 'OverconstrainedError') {
      status.textContent = '⚙️ Не удалось применить настройки камеры. Попробуйте по умолчанию.';
      // Повтор с минимальными настройками
      fallbackStartCamera();
      return;
    } else {
      status.textContent = `❌ Ошибка: ${err.message}`;
    }
    status.className = 'error';
    startBtn.disabled = false;
  }
}

// 🔄 Фоллбэк: камера с настройками по умолчанию
async function fallbackStartCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      video.play().then(startFaceDetection);
    };
    status.textContent = '✅ Камера запущена (базовые настройки)';
    status.className = 'success';
  } catch (err) {
    status.textContent = `❌ Не удалось запустить камеру: ${err.message}`;
    startBtn.disabled = false;
  }
}

// 🔍 Основной цикл детекции
function startFaceDetection() {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.getElementById('video-container').append(canvas);
  
  const displaySize = { width: video.offsetWidth, height: video.offsetHeight };
  faceapi.matchDimensions(canvas, displaySize);
  
  // 🔄 Детекция каждые 100мс
  setInterval(async () => {
    if (!video.readyState || video.readyState < 2) return; // Ждём данные видео
    
    try {
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
        .withFaceLandmarks(true)
        .withFaceExpressions()
        .withAgeAndGender();
      
      const resized = faceapi.resizeResults(detections, displaySize);
      
      // Очистка и отрисовка
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      faceapi.draw.drawDetections(canvas, resized);
      faceapi.draw.drawFaceLandmarks(canvas, resized);
      faceapi.draw.drawFaceExpressions(canvas, resized);
      
      // Возраст/пол текстом
      resized.forEach(result => {
        const { age, gender, genderProbability } = result;
        if (age && gender) {
          new faceapi.draw.DrawTextField(
            [`${Math.round(age)} лет`, `${gender === 'male' ? 'М' : 'Ж'} ${(genderProbability * 100).toFixed(0)}%`],
            result.detection.box.bottomRight
          ).draw(canvas);
        }
      });
      
    } catch (err) {
      console.warn('⚠️ Ошибка детекции:', err);
      // Не прерываем цикл при единичной ошибке
    }
  }, 100);
}

// 🚀 Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  // 🔐 Проверка контекста безопасности
  if (location.protocol === 'file:') {
    status.textContent = '⚠️ Откройте через HTTP-сервер, не через file://';
    status.className = 'error';
    console.warn('💡 Запустите локальный сервер: python -m http.server 8000');
    return;
  }
  
  if (location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    status.textContent = '⚠️ Для камеры требуется HTTPS или localhost';
    status.className = 'error';
    console.warn('💡 Используйте localhost или настройте HTTPS');
  }
  
  // Загрузка моделей
  loadModels();
  
  // Обработчик кнопки
  startBtn.addEventListener('click', startCamera);
});

// 🧹 Очистка при закрытии страницы
window.addEventListener('beforeunload', () => {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
});
