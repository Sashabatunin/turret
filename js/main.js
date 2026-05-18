// Конфигурация
const MODEL_URL = './models';
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

// DOM элементы
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const loading = document.getElementById('loading');
const progress = document.getElementById('progress');
const webcamContainer = document.getElementById('webcam-container');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const errorDiv = document.getElementById('error');
const showBoxes = document.getElementById('showBoxes');
const showLandmarks = document.getElementById('showLandmarks');

// Состояние
let detectionInterval = null;
let stream = null;
let displaySize = { width: VIDEO_WIDTH, height: VIDEO_HEIGHT };

// Загрузка моделей с прогрессом
async function loadModels() {
  const models = [
    faceapi.nets.tinyFaceDetector,
    faceapi.nets.faceLandmark68Net,
  ];
  
  let loaded = 0;
  const total = models.length;
  
  for (const model of models) {
    await model.loadFromUri(MODEL_URL);
    loaded++;
    progress.textContent = `${Math.round((loaded / total) * 100)}%`;
  }
  
  return true;
}

// Запуск веб-камеры
async function startWebcam() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        width: { ideal: VIDEO_WIDTH },
        height: { ideal: VIDEO_HEIGHT }
      },
      audio: false
    });
    
    video.srcObject = stream;
    await video.play();
    
    // Настройка canvas
    faceapi.matchDimensions(canvas, displaySize);
    
    // Переключение интерфейса
    loading.classList.add('hidden');
    webcamContainer.classList.remove('hidden');
    startBtn.disabled = true;
    stopBtn.disabled = false;
    errorDiv.textContent = '';
    
    // Запуск детекции
    startDetection();
    
  } catch (err) {
    console.error('Ошибка доступа к камере:', err);
    errorDiv.textContent = `❌ Ошибка: ${err.message || 'Не удалось получить доступ к камере'}`;
  }
}

// Остановка камеры
function stopWebcam() {
  if (detectionInterval) {
    clearInterval(detectionInterval);
    detectionInterval = null;
  }
  
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  
  video.srcObject = null;
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  
  webcamContainer.classList.add('hidden');
  loading.classList.remove('hidden');
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

// Основной цикл детекции
async function startDetection() {
  detectionInterval = setInterval(async () => {
    try {
      // Детекция лиц с опциями
      const detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.5
        }))
        .withFaceLandmarks();
      
      // Изменение размера результатов под display
      const resizedDetections = faceapi.resizeResults(detections, displaySize);
      
      // Очистка canvas
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Отрисовка результатов
      if (showBoxes.checked) {
        faceapi.draw.drawDetections(canvas, resizedDetections);
      }
      
      if (showLandmarks.checked) {
        faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
      }
      
    } catch (err) {
      console.error('Ошибка детекции:', err);
    }
  }, 100); // Обновление каждые 100мс (~10 FPS)
}

// Обработчики событий
startBtn.addEventListener('click', startWebcam);
stopBtn.addEventListener('click', stopWebcam);

// Инициализация при загрузке
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadModels();
    loading.innerHTML = '✅ Модели загружены! Нажмите "Запустить камеру"';
  } catch (err) {
    console.error('Ошибка загрузки моделей:', err);
    loading.innerHTML = `❌ Ошибка загрузки моделей: ${err.message}`;
    errorDiv.textContent = 'Убедитесь, что папка models содержит необходимые файлы';
  }
});

// Очистка при закрытии страницы
window.addEventListener('beforeunload', stopWebcam);
