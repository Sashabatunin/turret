const video = document.getElementById('video');
const MODEL_URL = '/models'; // Путь к папке с моделями

// Загрузка всех необходимых моделей
async function loadModels() {
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    faceapi.nets.ageGenderNet.loadFromUri(MODEL_URL)
  ]);
  console.log('✅ Модели загружены');
}

// Запуск веб-камеры
async function startVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { width: 720, height: 560 },
      audio: false 
    });
    video.srcObject = stream;
  } catch (err) {
    console.error('❌ Ошибка доступа к камере:', err);
    alert('Разрешите доступ к камере!');
  }
}

// Отрисовка результатов
function drawResults(detections, canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  if (document.getElementById('box-switch').checked) {
    faceapi.draw.drawDetections(canvas, detections);
  }
  if (document.getElementById('landmarks-switch').checked) {
    faceapi.draw.drawFaceLandmarks(canvas, detections);
  }
  if (document.getElementById('expression-switch').checked) {
    faceapi.draw.drawFaceExpressions(canvas, detections);
  }
  if (document.getElementById('age-gender-switch').checked) {
    detections.forEach(result => {
      const { age, gender, genderProbability } = result;
      new faceapi.draw.DrawTextField(
        [`${Math.round(age)} лет`, `${gender} (${(genderProbability * 100).toFixed(0)}%)`],
        result.detection.box.bottomRight
      ).draw(canvas);
    });
  }
}

// Основной цикл детекции
async function detectFaces() {
  const canvas = faceapi.createCanvasFromMedia(video);
  document.getElementById('video-container').append(canvas);
  
  const displaySize = { width: video.width, height: video.height };
  faceapi.matchDimensions(canvas, displaySize);

  setInterval(async () => {
    const detections = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks(true)
      .withFaceExpressions()
      .withAgeAndGender();
    
    const resized = faceapi.resizeResults(detections, displaySize);
    drawResults(resized, canvas);
  }, 100); // Интервал 100мс для плавной анимации
}

// Инициализация
Promise.all([
  loadModels(),
  new Promise(resolve => video.onloadedmetadata = resolve)
]).then(() => {
  startVideo();
  video.onplay = detectFaces;
});

// Обработчики чекбоксов
['box', 'landmarks', 'expression', 'age-gender'].forEach(id => {
  document.getElementById(id + '-switch')?.addEventListener('change', () => {
    // Перерисовка произойдёт в следующем цикле detectFaces
  });
});
