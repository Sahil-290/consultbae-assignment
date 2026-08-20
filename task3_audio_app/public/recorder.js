// Elements
const recTab = document.getElementById('tabRecord');
const upTab = document.getElementById('tabUpload');
const contentRecord = document.getElementById('contentRecord');
const contentUpload = document.getElementById('contentUpload');

const nameInput = document.getElementById('workerName');
const phoneInput = document.getElementById('workerPhone');
const submitBtn = document.getElementById('submitBtn');
const submissionForm = document.getElementById('submissionForm');

let activeTab = 'record'; 
let myFile = null;  
let audioBlob = null;  
let audioUrl = null;

// Tab switcher
recTab.addEventListener('click', () => {
  activeTab = 'record';
  contentRecord.hidden = false;
  contentUpload.hidden = true;
  clearUploadSelection();
  checkFormValidity();
});

upTab.addEventListener('click', () => {
  activeTab = 'upload';
  contentUpload.hidden = false;
  contentRecord.hidden = true;
  clearRecording();
  checkFormValidity();
});

function checkFormValidity() {
  const nameFilled = nameInput.value.trim().length > 0;
  const phoneFilled = phoneInput.value.trim().length > 0;
  const audioOk = activeTab === 'record' ? !!audioBlob : !!myFile;
  
  submitBtn.disabled = !(nameFilled && phoneFilled && audioOk);
}

nameInput.addEventListener('input', checkFormValidity);
phoneInput.addEventListener('input', checkFormValidity);

// Drag & Drop / File Selection
const dragArea = document.getElementById('dragArea');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const removeFileBtn = document.getElementById('removeFileBtn');
const previewDiv = document.getElementById('audioPreviewContainer');
const previewAudio = document.getElementById('audioPreview');

dragArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

dragArea.addEventListener('dragover', (e) => {
  e.preventDefault();
});

dragArea.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  myFile = file;
  fileName.textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(2) + ' MB)';
  fileInfo.hidden = false;
  dragArea.hidden = true;
  
  previewAudio.src = URL.createObjectURL(file);
  previewDiv.hidden = false;
  
  checkFormValidity();
}

removeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  clearUploadSelection();
  checkFormValidity();
});

function clearUploadSelection() {
  myFile = null;
  fileInput.value = '';
  fileName.textContent = '';
  fileInfo.hidden = true;
  dragArea.hidden = false;
  previewAudio.src = '';
  previewDiv.hidden = true;
}

// Mic Recording Logic using standard MediaRecorder
const recordBtn = document.getElementById('recordBtn');
const recordTimer = document.getElementById('recordTimer');

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let startTime = 0;
let timerInterval = null;

recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

async function startRecording() {
  clearRecording();
  
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream);
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };
    
    mediaRecorder.onstop = () => {
      audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
      audioUrl = URL.createObjectURL(audioBlob);
      
      previewAudio.src = audioUrl;
      previewDiv.hidden = false;
      
      checkFormValidity();
    };
    
    mediaRecorder.start();
    isRecording = true;
    recordBtn.textContent = 'Stop';
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 500);
    
  } catch (err) {
    console.error('Error starting audio recording:', err);
    alert('Microphone access denied or not found.');
  }
}

function stopRecording() {
  if (!isRecording) return;
  
  isRecording = false;
  recordBtn.textContent = 'Record';
  clearInterval(timerInterval);
  
  if (mediaRecorder) {
    mediaRecorder.stop();
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
}

function updateTimer() {
  const elapsed = Date.now() - startTime;
  const totalSeconds = Math.floor(elapsed / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  recordTimer.textContent = m + ':' + s;
}

function clearRecording() {
  audioBlob = null;
  audioUrl = null;
  recordedChunks = [];
  recordTimer.textContent = '00:00';
  previewAudio.src = '';
  previewDiv.hidden = true;
}

// Form Submission
submissionForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData();
  formData.append('name', nameInput.value.trim());
  formData.append('phone', phoneInput.value.trim());
  
  if (previewAudio.duration && !isNaN(previewAudio.duration)) {
    formData.append('duration', previewAudio.duration);
  }
  
  if (activeTab === 'record') {
    formData.append('audio', audioBlob, 'recording.webm');
  } else {
    formData.append('audio', myFile);
  }
  
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  
  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      body: formData
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Submission failed');
    }
    
    alert('Audio submitted successfully!');
    nameInput.value = '';
    phoneInput.value = '';
    clearRecording();
    clearUploadSelection();
    checkFormValidity();
    loadSubmissions();
  } catch (err) {
    alert(err.message);
  } finally {
    submitBtn.textContent = 'Submit Audio Record';
  }
});

// Fetch and Render logs
const subList = document.getElementById('submissionsList');
const subCount = document.getElementById('submissionCount');

async function loadSubmissions() {
  try {
    const res = await fetch('/api/submissions');
    const list = await res.json();
    
    subCount.textContent = list.length;
    subList.innerHTML = '';
    
    if (list.length === 0) {
      subList.innerHTML = '<div>No audio submissions found. Upload or record audio to get started.</div>';
      return;
    }
    
    list.forEach(item => {
      const card = document.createElement('div');
      card.className = 'submission-item';
      card.innerHTML = `
        <h3>Name: ${item.name} (${item.phone})</h3>
        <p><strong>Duration:</strong> ${item.audio_duration} sec | <strong>Sample Rate:</strong> ${item.audio_sample_rate_khz} kHz</p>
        <p><strong>Loudness:</strong> ${item.audio_loudness_db} dB | <strong>Bitrate:</strong> ${item.audio_bitrate_kbps} kbps | <strong>Quality:</strong> ${item.audio_quality_estimate}</p>
        <div style="margin-top: 10px;">
          <audio src="/uploads/${item.audio_filename}" controls></audio>
        </div>
      `;
      subList.appendChild(card);
    });
  } catch (err) {
    subList.innerHTML = '<div style="color: red;">Failed to load submissions.</div>';
  }
}

loadSubmissions();
