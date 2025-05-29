let audioCtx = null;
let kickBuffer = null;
let snareBuffer = null;
let hihatBuffer = null;
let lockPosition = null;
let reverseMapping = false;
let watchId = null;
let orientationActive = false;
let motionActive = false;
let cameraActive = false;
let lightSensorActive = false;
let micActive = false;
let currentHeading = 0;
let previousHeading = 0;
let micStream = null;
let analyser = null;
let isPlaying = false;
let nextNoteTime = 0;
let scheduleAheadTime = 0.1;
let lookaheadInterval = null;

let tempo = 20;
let kickPulses = 4;
let snarePulses = 2;
let hihatPulses = 8;
let steps = 16;
let distanceBand = 50;
let kickGainNode = null;
let snareGainNode = null;
let hihatGainNode = null;

let freeMode = false;
let lastPosition = null;
let lastUpdateTime = null;

const statusEl = document.getElementById("status");
let compassSection = null;
let compassSvg = null;
let directionArrow = null;
let distanceDisplay = null;
let freeModeStatus = null;

function log(msg, isError = false) {
  console.log(msg);
  if (statusEl) {
    statusEl.textContent = `Status: ${msg}`;
    statusEl.className = `status ${isError ? 'error' : 'success'}`;
  }
}

function generateEuclideanRhythm(k, n, rotation = 0) {
  if (k > n) k = n;
  if (k < 0) k = 0;
  let buckets = new Array(n).fill(0);
  let pattern = [];
  
  let counts = new Array(n).fill(0);
  let remainders = new Array(n).fill(0);
  let level = 0;
  let divisor = n - k;
  remainders[0] = k;
  
  while (remainders[level] > 1) {
    counts[level] = Math.floor(divisor / remainders[level]);
    remainders[level + 1] = divisor % remainders[level];
    divisor = remainders[level];
    level++;
  }
  counts[level] = divisor;
  
  function build(level) {
    if (level == -1) {
      pattern.push(0);
    } else if (level == -2) {
      pattern.push(1);
    } else {
      for (let i = 0; i < counts[level]; i++) {
        build(level - 1);
      }
      if (remainders[level] !== 0) {
        build(level - 2);
      }
    }
  }
  
  build(level);
  
  rotation = rotation % n;
  if (rotation < 0) rotation += n;
  return pattern.slice(-rotation).concat(pattern.slice(0, -rotation));
}

async function loadSample(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status} ${response.statusText} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      log(`Successfully loaded sample: ${url}`);
      return audioBuffer;
    } catch (decodeErr) {
      throw new Error(`Decoding error for ${url}: ${decodeErr.message}`);
    }
  } catch (err) {
    log(`Failed to load sample ${url}: ${err.message}`, true);
    return null;
  }
}

async function initAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume().catch(err => {
        log("Failed to resume AudioContext: " + err.message, true);
        throw err;
      });
      log("Audio context resumed");
    } else if (audioCtx.state === 'closed') {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      log("Audio context recreated");
    }

    if (!kickBuffer) {
      kickBuffer = await loadSample('kick.wav');
      if (!kickBuffer) log("Kick sample failed to load, but continuing", true);
    }
    if (!snareBuffer) {
      snareBuffer = await loadSample('snare.wav');
      if (!snareBuffer) log("Snare sample failed to load, but continuing", true);
    }
    if (!hihatBuffer) {
      hihatBuffer = await loadSample('hat.wav');
      if (!hihatBuffer) log("Hi-hat sample failed to load, but continuing", true);
    }

    kickGainNode = audioCtx.createGain();
    kickGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    kickGainNode.connect(audioCtx.destination);

    snareGainNode = audioCtx.createGain();
    snareGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    snareGainNode.connect(audioCtx.destination);

    hihatGainNode = audioCtx.createGain();
    hihatGainNode.gain.setValueAtTime(0.7, audioCtx.currentTime);
    hihatGainNode.connect(audioCtx.destination);

    if (!kickBuffer && !snareBuffer && !hihatBuffer) {
      throw new Error("All samples failed to load. Cannot proceed.");
    }

    log("Audio initialized successfully");
    return true;
  } catch (err) {
    log("Audio initialization error: " + err.message, true);
    return false;
  }
}

function playSample(buffer, gainNode, time, pitch = 1.0) {
  if (!buffer) {
    return;
  }
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.setValueAtTime(pitch, time);
  source.connect(gainNode);
  source.start(time);
}

function scheduleNotes() {
  while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
    const secondsPerBeat = 60.0 / tempo;
    const headingRotation = Math.floor(currentHeading / 45);
    const headingChange = Math.abs(currentHeading - previousHeading);
    const randomOffset = headingChange > 10 ? Math.floor(Math.random() * 3) - 1 : 0;

    if (headingChange > 10 && !orientationActive) {
      kickPulses = Math.max(1, Math.min(8, kickPulses + (Math.floor(Math.random() * 3) - 1)));
      snarePulses = Math.max(1, Math.min(8, snarePulses + (Math.floor(Math.random() * 3) - 1)));
      hihatPulses = Math.max(1, Math.min(16, hihatPulses + (Math.floor(Math.random() * 3) - 1)));

      document.getElementById("kickPulses").value = kickPulses;
      document.getElementById("kickPulsesValue").textContent = `${kickPulses} pulses`;
      document.getElementById("kickPulses").setAttribute("aria-valuenow", kickPulses);

      document.getElementById("snarePulses").value = snarePulses;
      document.getElementById("snarePulsesValue").textContent = `${snarePulses} pulses`;
      document.getElementById("snarePulses").setAttribute("aria-valuenow", snarePulses);

      document.getElementById("hihatPulses").value = hihatPulses;
      document.getElementById("hihatPulsesValue").textContent = `${hihatPulses} pulses`;
      document.getElementById("hihatPulses").setAttribute("aria-valuenow", hihatPulses);

      log(`Pulses randomized - Kick: ${kickPulses}, Snare: ${snarePulses}, Hi-Hat: ${hihatPulses}`);
    }

    const kickPattern = generateEuclideanRhythm(kickPulses, steps, headingRotation + randomOffset);
    const snarePattern = generateEuclideanRhythm(snarePulses, steps, headingRotation + randomOffset);
    const hihatPattern = generateEuclideanRhythm(hihatPulses, steps, headingRotation + randomOffset);

    for (let i = 0; i < steps; i++) {
      const time = nextNoteTime + i * (secondsPerBeat / steps);
      if (kickPattern[i]) playSample(kickBuffer, kickGainNode, time);
      if (snarePattern[i]) playSample(snareBuffer, snareGainNode, time);
      if (hihatPattern[i]) playSample(hihatBuffer, hihatGainNode, time);
    }
    nextNoteTime += secondsPerBeat;
  }
  previousHeading = currentHeading;
}

function startScheduler() {
  if (!isPlaying) {
    isPlaying = true;
    nextNoteTime = audioCtx.currentTime;
    scheduleNotes();
    lookaheadInterval = setInterval(scheduleNotes, 25);
    log("Drum machine started");
  }
}

async function stopAudio() {
  try {
    if (isPlaying) {
      isPlaying = false;
      clearInterval(lookaheadInterval);
      lookaheadInterval = null;
      log("Drum machine stopped");
    }
    if (audioCtx) {
      await audioCtx.suspend();
      log("Audio context suspended");
    }
  } catch (err) {
    log("Error stopping audio: " + err.message, true);
  }
}

function updateTempo(distanceOrSpeed) {
  let newTempo;
  if (freeMode) {
    const maxSpeed = 5; // meters per second
    const normalizedSpeed = Math.min(Math.max(distanceOrSpeed / maxSpeed, 0), 1);
    newTempo = 20 + normalizedSpeed * (200 - 20);
  } else {
    const normalizedDistance = Math.min(Math.max(distanceOrSpeed / distanceBand, 0), 1);
    newTempo = reverseMapping 
      ? 20 + (1 - normalizedDistance) * (200 - 20)
      : 20 + normalizedDistance * (200 - 20);
  }
  tempo = newTempo;
  document.getElementById("tempoValue").textContent = `${tempo.toFixed(1)} BPM`;
}

function updateCompassDisplay(distance, bearing) {
  if (!compassSection || !directionArrow || !distanceDisplay || freeMode) return;
  const arrowRotation = bearing - currentHeading;
  directionArrow.setAttribute('transform', `rotate(${-arrowRotation}, 100, 100)`);
  distanceDisplay.textContent = `${distance.toFixed(0)}m`;
}

function calculateBearing(coords1, coords2) {
  const φ1 = coords1.latitude * Math.PI / 180;
  const φ2 = coords2.latitude * Math.PI / 180;
  const λ1 = coords1.longitude * Math.PI / 180;
  const λ2 = coords2.longitude * Math.PI / 180;
  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - 
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
  const θ = Math.atan2(y, x);
  return (θ * 180 / Math.PI + 360) % 360;
}

async function startGpsTracking() {
  if (!navigator.geolocation) {
    log("Geolocation not supported by this browser or device.", true);
    return;
  }

  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    log("Cleared previous GPS watch");
  }

  try {
    watchId = navigator.geolocation.watchPosition(
      pos => {
        const currentTime = Date.now() / 1000;
        if (!freeMode) {
          if (!lockPosition) {
            lockPosition = pos.coords;
            tempo = 20;
            updateTempo(0);
            nextNoteTime = audioCtx.currentTime;
            log(`GPS position locked: Lat ${lockPosition.latitude.toFixed(4)}, Lon ${lockPosition.longitude.toFixed(4)}`);
            log(`Initial tempo set to: ${tempo} BPM`);
          }
          const distance = calculateDistance(pos.coords, lockPosition);
          updateTempo(distance);
          if (isPlaying) scheduleNotes();
          
          if (currentHeading !== null) {
            const bearing = calculateBearing(pos.coords, lockPosition);
            updateCompassDisplay(distance, bearing);
          }
        } else {
          if (lastPosition && lastUpdateTime) {
            const distance = calculateDistance(pos.coords, lastPosition);
            const timeDiff = currentTime - lastUpdateTime;
            const speed = timeDiff > 0 ? distance / timeDiff : 0;
            updateTempo(speed);
            if (isPlaying) scheduleNotes();
            log(`Speed: ${speed.toFixed(2)} m/s, Tempo: ${tempo.toFixed(1)} BPM`);
          }
          lastPosition = pos.coords;
          lastUpdateTime = currentTime;
        }
      },
      err => {
        log(`GPS error: ${err.message}`, true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } catch (err) {
    log(`GPS error: ${err.message}`, true);
  }
}

function calculateDistance(coords1, coords2) {
  if (!coords1 || !coords2 || !coords1.latitude || !coords2.latitude) {
    log("Invalid coordinates for distance calculation", true);
    return 0;
  }
  const R = 6371e3;
  const φ1 = coords1.latitude * Math.PI / 180;
  const φ2 = coords2.latitude * Math.PI / 180;
  const Δφ = (coords2.latitude - coords1.latitude) * Math.PI / 180;
  const Δλ = (coords2.longitude - coords1.longitude) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function handleOrientation(event) {
  if (!orientationActive) return;

  const beta = event.beta;
  const alpha = event.alpha;
  
  if (beta === null || alpha === null) {
    log("Orientation data unavailable", true);
    return;
  }

  currentHeading = alpha;
  
  const normalizedBeta = (beta + 180) / 360;
  kickPulses = Math.max(1, Math.min(8, Math.round(normalizedBeta * 7) + 1));
  snarePulses = Math.max(1, Math.min(8, Math.round(normalizedBeta * 7) + 1));
  hihatPulses = Math.max(1, Math.min(8, Math.round(normalizedBeta * 7) + 1));
  
  document.getElementById("kickPulses").value = kickPulses;
  document.getElementById("kickPulsesValue").textContent = `${kickPulses} pulses`;
  document.getElementById("snarePulses").value = snarePulses;
  document.getElementById("snarePulsesValue").textContent = `${snarePulses} pulses`;
  document.getElementById("hihatPulses").value = hihatPulses;
  document.getElementById("hihatPulsesValue").textContent = `${hihatPulses} pulses`;
  
  if (lockPosition) {
    navigator.geolocation.getCurrentPosition(pos => {
      const distance = calculateDistance(pos.coords, lockPosition);
      const bearing = calculateBearing(pos.coords, lockPosition);
      updateCompassDisplay(distance, bearing);
    });
  }
}

async function requestOrientationPermission() {
  try {
    await audioCtx?.resume();
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission === "granted") {
        orientationActive = true;
        window.addEventListener("deviceorientation", handleOrientation);
        log("Orientation access granted. Tilt device to adjust drum patterns.");
      } else {
        log("Orientation permission denied.", true);
      }
    } else {
      orientationActive = true;
      window.addEventListener("deviceorientation", handleOrientation);
      log("Orientation enabled. Tilt device to adjust drum patterns.");
    }
  } catch (err) {
    log("Orientation error: " + err.message, true);
  }
}

async function initCamera() {
  try {
    await audioCtx?.resume();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = document.getElementById("video");
    video.srcObject = stream;
    video.classList.remove("hidden");
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext("2d");

    let lastUpdate = 0;
    function processCamera(timestamp) {
      if (!cameraActive) return;
      if (timestamp - lastUpdate < 100) {
        requestAnimationFrame(processCamera);
        return;
      }
      lastUpdate = timestamp;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        const brightness = (imageData.data[i] + imageData.data[i + 1] + imageData.data[i + 2]) / 3;
        sum += brightness;
      }
      const avgBrightness = sum / (imageData.data.length / 4);
      const normalizedBrightness = avgBrightness / 255;
      const gain = 0.5 + normalizedBrightness * 0.5;
      if (kickGainNode) {
        kickGainNode.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.02);
        snareGainNode.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.02);
        hihatGainNode.gain.linearRampToValueAtTime(gain * 0.7, audioCtx.currentTime + 0.02);
      }
      requestAnimationFrame(processCamera);
    }
    video.onloadedmetadata = () => requestAnimationFrame(processCamera);
    log("Camera initialized. Brightness adjusts drum volume.");
  } catch (err) {
    log("Camera error: " + err.message, true);
  }
}

async function requestMotionPermission() {
  try {
    await audioCtx?.resume();
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission === "granted") {
        motionActive = true;
        window.addEventListener("devicemotion", handleMotion);
        log("Motion access granted. Shake device to adjust hi-hat frequency.");
      } else {
        log("Motion permission denied.", true);
      }
    } else {
      motionActive = true;
      window.addEventListener("devicemotion", handleMotion);
      log("Motion enabled. Shake device to adjust hi-hat frequency.");
    }
  } catch (err) {
    log("Motion error: " + err.message, true);
  }
}

function handleMotion(event) {
  if (!motionActive) return;
  const accel = event.acceleration;
  if (!accel || accel.x === null) {
    log("Motion data unavailable", true);
    return;
  }
  const magnitude = Math.sqrt(accel.x ** 2 + accel.y ** 2 + accel.z ** 2);
  const mappedMagnitude = Math.min(magnitude, 10);
  hihatPulses = Math.max(1, Math.min(16, Math.round(mappedMagnitude * 1.6)));
  document.getElementById("hihatPulses").value = hihatPulses;
  document.getElementById("hihatPulsesValue").textContent = `${hihatPulses} pulses`;
  document.getElementById("hihatPulses").setAttribute("aria-valuenow", hihatPulses);
  log(`Hi-hat pulses adjusted: ${hihatPulses} (Shake: ${magnitude.toFixed(1)}g)`);
}

async function initLightSensor() {
  try {
    await audioCtx?.resume();
    if (!('AmbientLightSensor' in window)) {
      log("Ambient Light Sensor not supported by this browser or device.", true);
      return;
    }
    const sensor = new AmbientLightSensor();
    sensor.onreading = () => {
      if (!lightSensorActive) return;
      const illuminance = sensor.illuminance;
      const normalizedIlluminance = Math.min(Math.max(illuminance / 100000, 0), 1);
      const gain = 0.5 + normalizedIlluminance * 0.5;
      if (kickGainNode) {
        kickGainNode.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.02);
        snareGainNode.gain.linearRampToValueAtTime(gain, audioCtx.currentTime + 0.02);
        hihatGainNode.gain.linearRampToValueAtTime(gain * 0.7, audioCtx.currentTime + 0.02);
      }
      log(`Volume adjusted: ${gain.toFixed(2)} (Light: ${illuminance.toFixed(1)} lux)`);
    };
    sensor.onerror = (event) => {
      log(`Light sensor error: ${event.error.message}`, true);
    };
    sensor.start();
    log("Light sensor initialized. Ambient light adjusts drum volume.");
  } catch (err) {
    log("Light sensor error: " + err.message, true);
  }
}

async function initMicrophone() {
  try {
    await audioCtx?.resume();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    let lastUpdate = 0;
    function processMicAudio(timestamp) {
      if (!micActive || !analyser) {
        requestAnimationFrame(processMicAudio);
        return;
      }
      if (timestamp - lastUpdate < 100) {
        requestAnimationFrame(processMicAudio);
        return;
      }
      lastUpdate = timestamp;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      analyser.getFloatFrequencyData(dataArray);

      let maxIndex = 0;
      let maxValue = -Infinity;
      for (let i = 0; i < bufferLength; i++) {
        if (dataArray[i] > maxValue) {
          maxValue = dataArray[i];
          maxIndex = i;
        }
      }

      const sampleRate = audioCtx.sampleRate;
      const frequency = (maxIndex * sampleRate) / analyser.fftSize;
      const normalizedFreq = Math.min(Math.max((frequency - 50) / (2000 - 50), 0), 1);
      const pitch = 0.5 + normalizedFreq * 1.0;
      log(`Pitch adjusted: ${pitch.toFixed(2)}x (Mic: ${frequency.toFixed(1)} Hz)`);
      requestAnimationFrame(processMicAudio);
    }
    requestAnimationFrame(processMicAudio);
    log("Microphone initialized. Audio input controls drum pitch.");
  } catch (err) {
    log("Microphone error: " + err.message, true);
  }
}

function shareLockPoint() {
  if (!lockPosition && !freeMode) {
    log('No lock position set. Please lock GPS first.', true);
    return;
  }

  const position = freeMode && lastPosition ? lastPosition : lockPosition;
  if (!position) {
    log('No position available to share. Please lock GPS or enable Free Mode and move.', true);
    return;
  }

  const { latitude, longitude } = position;
  const baseUrl = window.location.origin || 'https://drum-machine.app';
  const shareUrl = `${baseUrl}?lat=${latitude.toFixed(6)}&lon=${longitude.toFixed(6)}`;
  document.getElementById('sessionId').value = shareUrl;
  try {
    navigator.clipboard.writeText(shareUrl);
    log('Lock Point URL copied to clipboard! Share it with another user.');
  } catch (err) {
    log('Failed to copy URL to clipboard. Please copy manually.', true);
  }
}

function joinLockPoint() {
  const joinSessionId = document.getElementById('joinSessionId').value;
  if (!joinSessionId) {
    log('Please enter a URL to join.', true);
    return;
  }

  try {
    const url = new URL(joinSessionId);
    const lat = parseFloat(url.searchParams.get('lat'));
    const lon = parseFloat(url.searchParams.get('lon'));

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      log('Invalid coordinates in the URL.', true);
      return;
    }

    lockPosition = { latitude: lat, longitude: lon };
    tempo = 20;
    updateTempo(0);
    nextNoteTime = audioCtx.currentTime;
    log(`Locked onto shared position: Lat ${lat.toFixed(4)}, Lon ${lon.toFixed(4)}`);

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    watchId = navigator.geolocation.watchPosition(
      pos => {
        if (!lockPosition) {
          log('Lock position not set', true);
          return;
        }
        const distance = calculateDistance(pos.coords, lockPosition);
        updateTempo(distance);
        if (isPlaying) scheduleNotes();
        if (currentHeading !== null) {
          const bearing = calculateBearing(pos.coords, lockPosition);
          updateCompassDisplay(distance, bearing);
        }
      },
      err => log(`GPS error: ${err.message}`, true),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    compassSection.style.display = 'block';
    if (!isPlaying) startScheduler();
  } catch (err) {
    log(`Failed to join Lock Point: ${err.message}`, true);
  }
}

function toggleFreeMode() {
  freeMode = !freeMode;
  if (freeModeStatus) {
    freeModeStatus.textContent = freeMode ? 'On' : 'Off';
  }
  if (freeMode) {
    log('Free Mode enabled. Tempo now based on movement speed.');
    lockPosition = null;
    compassSection.style.display = 'none';
  } else {
    log('Free Mode disabled. Returning to lock-based mode.');
    compassSection.style.display = 'block';
  }
  startGpsTracking();
}

document.addEventListener("DOMContentLoaded", () => {
  compassSection = document.getElementById("compass-section");
  compassSvg = document.getElementById("compass");
  directionArrow = document.getElementById("direction-arrow");
  distanceDisplay = document.getElementById("distance-display");
  freeModeStatus = document.getElementById("freeModeStatus");

  const elements = {
    lockBtn: document.getElementById("lockBtn"),
    testBtn: document.getElementById("testBtn"),
    stopBtn: document.getElementById("stopBtn"),
    toggleDirectionBtn: document.getElementById("toggleDirectionBtn"),
    orientationBtn: document.getElementById("orientationBtn"),
    motionBtn: document.getElementById("motionBtn"),
    cameraBtn: document.getElementById("cameraBtn"),
    lightSensorBtn: document.getElementById("lightSensorBtn"),
    micBtn: document.getElementById("micBtn"),
    kickPulsesInput: document.getElementById("kickPulses"),
    snarePulsesInput: document.getElementById("snarePulses"),
    hihatPulsesInput: document.getElementById("hihatPulses"),
    distanceBandSelect: document.getElementById("distanceBand"),
    shareLockBtn: document.getElementById("shareLockBtn"),
    joinLockBtn: document.getElementById("joinLockBtn"),
    toggleFreeModeBtn: document.getElementById("toggleFreeModeBtn"),
  };

  if (Object.values(elements).some(el => !el)) {
    const missing = Object.keys(elements).filter(key => !elements[key]);
    log(`One or more UI elements not found. Missing IDs: ${missing.join(', ')}`, true);
    console.error("Missing elements:", missing);
    return;
  }

  // Toggle button color state
  const buttonStates = {};
  const buttons = [
    elements.lockBtn,
    elements.testBtn,
    elements.stopBtn,
    elements.toggleFreeModeBtn,
    elements.toggleDirectionBtn,
    elements.orientationBtn,
    elements.motionBtn,
    elements.cameraBtn,
    elements.lightSensorBtn,
    elements.micBtn,
    elements.shareLockBtn,
    elements.joinLockBtn,
  ];

  buttons.forEach(button => {
    buttonStates[button.id] = false; // Initial state: not pressed
    button.addEventListener("click", () => {
      buttonStates[button.id] = !buttonStates[button.id];
      button.classList.toggle("pressed", buttonStates[button.id]);
    });
  });

  // Debug log to confirm button is found
  console.log("Toggle Free Mode button found:", elements.toggleFreeModeBtn);

  elements.lockBtn.addEventListener("click", async () => {
    console.log("Lock GPS button clicked");
    freeMode = false;
    const audioSuccess = await initAudio();
    if (audioSuccess) {
      log("Starting GPS tracking...");
      await startGpsTracking();
      log("Starting audio scheduler...");
      startScheduler();
      compassSection.style.display = "block";
    } else {
      log("Audio initialization failed. Check console for details.", true);
    }
  });

  elements.testBtn.addEventListener("click", async () => {
    console.log("Test Audio button clicked");
    const audioSuccess = await initAudio();
    if (audioSuccess) {
      log("Playing test audio...");
      updateTempo(10);
      startScheduler();
    } else {
      log("Audio initialization failed. Check console for details.", true);
    }
  });

  elements.stopBtn.addEventListener("click", async () => {
    console.log("Stop Audio button clicked");
    await stopAudio();
  });

  elements.toggleDirectionBtn.addEventListener("click", async () => {
    await audioCtx?.resume();
    reverseMapping = !reverseMapping;
    log(`Tempo mapping ${reverseMapping ? "reversed" : "normal"}`);
  });

  elements.orientationBtn.addEventListener("click", async () => {
    console.log("Toggle Orientation button clicked");
    orientationActive = !orientationActive;
    if (orientationActive) {
      await initAudio();
      await requestOrientationPermission();
    } else {
      window.removeEventListener("deviceorientation", handleOrientation);
      log("Orientation disabled");
    }
  });

  elements.cameraBtn.addEventListener("click", async () => {
    console.log("Toggle Camera button clicked");
    cameraActive = !cameraActive;
    if (cameraActive) {
      await initAudio();
      await initCamera();
    } else {
      log("Camera disabled");
      const video = document.getElementById("video");
      if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.classList.add("hidden");
      }
    }
  });

  elements.motionBtn.addEventListener("click", async () => {
    console.log("Toggle Accelerometer button clicked");
    motionActive = !motionActive;
    if (motionActive) {
      await initAudio();
      await requestMotionPermission();
    } else {
      window.removeEventListener("devicemotion", handleMotion);
      log("Accelerometer disabled");
    }
  });

  elements.lightSensorBtn.addEventListener("click", async () => {
    console.log("Toggle Light Sensor button clicked");
    lightSensorActive = !lightSensorActive;
    if (lightSensorActive) {
      await initAudio();
      await initLightSensor();
    } else {
      log("Light sensor disabled");
    }
  });

  elements.micBtn.addEventListener("click", async () => {
    console.log("Toggle Microphone button clicked");
    micActive = !micActive;
    if (micActive) {
      await initAudio();
      await initMicrophone();
    } else {
      log("Microphone disabled");
      if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
      }
      if (analyser) {
        analyser.disconnect();
        analyser = null;
      }
    }
  });

  elements.kickPulsesInput.addEventListener("input", async (e) => {
    if (orientationActive) return;
    await audioCtx?.resume();
    kickPulses = parseInt(e.target.value);
    document.getElementById("kickPulsesValue").textContent = `${kickPulses} pulses`;
    e.target.setAttribute("aria-valuenow", kickPulses);
  });

  elements.snarePulsesInput.addEventListener("input", async (e) => {
    if (orientationActive) return;
    await audioCtx?.resume();
    snarePulses = parseInt(e.target.value);
    document.getElementById("snarePulsesValue").textContent = `${snarePulses} pulses`;
    e.target.setAttribute("aria-valuenow", snarePulses);
  });

  elements.hihatPulsesInput.addEventListener("input", async (e) => {
    if (orientationActive || motionActive) return;
    await audioCtx?.resume();
    hihatPulses = parseInt(e.target.value);
    document.getElementById("hihatPulsesValue").textContent = `${hihatPulses} pulses`;
    e.target.setAttribute("aria-valuenow", hihatPulses);
  });

  elements.distanceBandSelect.addEventListener("change", async (e) => {
    await audioCtx?.resume();
    distanceBand = parseFloat(e.target.value);
    log(`Distance band changed to ${distanceBand} meters`);
  });

  elements.shareLockBtn.addEventListener("click", () => {
    console.log("Share Lock Point button clicked");
    shareLockPoint();
  });

  elements.joinLockBtn.addEventListener("click", async () => {
    console.log("Join Lock Point button clicked");
    const audioSuccess = await initAudio();
    if (audioSuccess) {
      joinLockPoint();
    }
  });

  elements.toggleFreeModeBtn.addEventListener("click", () => {
    console.log("Toggle Free Mode button clicked");
    toggleFreeMode();
  });

  log("Page loaded successfully. Ready to use.");
});