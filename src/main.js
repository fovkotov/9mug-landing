import Lenis from "lenis";
import { play } from "cuelume";
import "./styles.css";

const baseUrl = import.meta.env.BASE_URL ?? "/";
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const lenis = prefersReducedMotion
  ? null
  : new Lenis({
      smoothWheel: true,
      wheelMultiplier: 1,
      syncTouch: true,
      touchMultiplier: 1.1,
      lerp: 0.09
    });

function resolvePublicAssetPath(path) {
  if (!path) return "";
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith("data:")) return path;
  if (!path.startsWith("/")) return path;
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}${path}`;
}

const radioBtn = document.querySelector("#radioBtn");
const noiseBtn = document.querySelector("#noiseBtn");
const radioIcon = document.querySelector("#radioIcon");
const radioPlayer = document.querySelector("#radioPlayer");
const priceToggle = document.querySelector("#priceToggle");
const priceToggleIcon = document.querySelector("#priceToggleIcon");
const bagStatusText = document.querySelector("#bagStatusText");

const radioTracks = ["/audio/track-1.mp3", "/audio/track-2.mp3", "/audio/track-3.mp3"].map(
  resolvePublicAssetPath
);
const radioPlayIconSource = resolvePublicAssetPath("/media/radio-icon-play.png");
const radioPauseIconSource = resolvePublicAssetPath("/media/radio-icon-pause.png");
const pricePlusIconSource = resolvePublicAssetPath("/media/price-plus.svg");
const priceCheckIconSource = resolvePublicAssetPath("/media/price-check-crisp.png");

let currentTrackIndex = 0;
let radioEnabled = false;
let noiseEnabled = false;
let activeAudioControl = "radio";
let bagSelected = false;

let audioContext = null;
let noiseNode = null;
let noiseGain = null;
let brownNoiseLastOut = 0;

function playButtonTick() {
  try {
    play("tick");
  } catch {
    // Sound feedback is optional if the sample is unavailable.
  }
}

function setRadioUiState() {
  const isRadioActive = activeAudioControl === "radio";
  radioBtn?.classList.toggle("is-active", isRadioActive);
  radioBtn?.classList.toggle("is-muted", !isRadioActive);

  if (radioIcon) {
    const isAnyAudioEnabled = radioEnabled || noiseEnabled;
    radioIcon.src = isAnyAudioEnabled ? radioPauseIconSource : radioPlayIconSource;
  }
}

function updateNoiseUiState() {
  const isNoiseActive = activeAudioControl === "noise";
  noiseBtn?.classList.toggle("is-active", isNoiseActive);
  noiseBtn?.classList.toggle("is-muted", !isNoiseActive);
}

function setBagUiState() {
  if (priceToggleIcon) {
    priceToggleIcon.src = bagSelected ? priceCheckIconSource : pricePlusIconSource;
  }
  bagStatusText?.classList.toggle("is-visible", bagSelected);
  priceToggle?.setAttribute("aria-pressed", String(bagSelected));
}

function ensureNoiseGraph() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {
      // Ignored: user interaction may still be required on some browsers.
    });
  }

  if (!noiseNode) {
    noiseNode = audioContext.createScriptProcessor(2048, 1, 1);
    noiseGain = audioContext.createGain();
    noiseGain.gain.value = 0.2;

    noiseNode.onaudioprocess = (event) => {
      const output = event.outputBuffer.getChannelData(0);
      for (let i = 0; i < output.length; i += 1) {
        const white = Math.random() * 2 - 1;
        brownNoiseLastOut = (brownNoiseLastOut + 0.02 * white) / 1.02;
        output[i] = brownNoiseLastOut * 3.5;
      }
    };

    noiseNode.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
  }
}

function enableBrownNoise() {
  ensureNoiseGraph();
  if (!audioContext || !noiseGain) return;
  noiseGain.gain.setTargetAtTime(0.2, audioContext.currentTime, 0.03);
  noiseEnabled = true;
  updateNoiseUiState();
}

function disableBrownNoise() {
  if (!audioContext || !noiseGain) return;
  noiseGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.03);
  noiseEnabled = false;
  updateNoiseUiState();
}

function playTrack(index) {
  if (!radioPlayer) return Promise.reject(new Error("No radio player found"));
  radioPlayer.src = radioTracks[index];
  radioPlayer.volume = 0.39;
  return radioPlayer.play();
}

async function toggleRadioPlayback() {
  if (!radioPlayer) return;
  playButtonTick();
  activeAudioControl = "radio";

  if (noiseEnabled) {
    disableBrownNoise();
  }

  radioEnabled = !radioEnabled;

  if (radioEnabled) {
    try {
      await playTrack(currentTrackIndex);
    } catch {
      radioEnabled = false;
    }
  } else {
    radioPlayer.pause();
  }

  setRadioUiState();
  updateNoiseUiState();
}

function toggleNoisePlayback() {
  playButtonTick();
  activeAudioControl = "noise";

  if (radioEnabled && radioPlayer) {
    radioEnabled = false;
    radioPlayer.pause();
  }

  if (!noiseEnabled) {
    enableBrownNoise();
  } else {
    disableBrownNoise();
  }

  setRadioUiState();
}

function toggleBagState() {
  playButtonTick();
  bagSelected = !bagSelected;
  setBagUiState();
}

if (radioPlayer) {
  radioPlayer.addEventListener("ended", async () => {
    if (!radioEnabled) return;
    currentTrackIndex = (currentTrackIndex + 1) % radioTracks.length;
    try {
      await playTrack(currentTrackIndex);
    } catch {
      radioEnabled = false;
      setRadioUiState();
    }
  });
}

radioBtn?.addEventListener("click", () => {
  toggleRadioPlayback();
});

noiseBtn?.addEventListener("click", () => {
  toggleNoisePlayback();
});

radioIcon?.addEventListener("click", () => {
  if (activeAudioControl === "noise") {
    toggleNoisePlayback();
    return;
  }
  toggleRadioPlayback();
});

priceToggle?.addEventListener("click", () => {
  toggleBagState();
});

priceToggleIcon?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleBagState();
});

priceToggle?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggleBagState();
});

setRadioUiState();
updateNoiseUiState();
setBagUiState();

if (lenis) {
  const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };

  requestAnimationFrame(raf);
}
