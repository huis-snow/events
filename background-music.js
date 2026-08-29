const SOUND_PREFERENCE_KEY = "guild-events-sound";
const LEGACY_BINGO_PREFERENCE_KEY = "guild-events-bingo-sound";

export function readSoundPreference() {
  try {
    const sharedPreference = window.localStorage.getItem(SOUND_PREFERENCE_KEY);
    if (sharedPreference) return sharedPreference !== "off";
    return window.localStorage.getItem(LEGACY_BINGO_PREFERENCE_KEY) !== "off";
  } catch (_error) {
    return true;
  }
}

export function saveSoundPreference(enabled) {
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? "on" : "off");
  } catch (_error) {
    // 저장소가 제한된 브라우저에서도 현재 페이지의 음악은 계속 동작한다.
  }
}

export function createBackgroundMusic({ source, volume = 0.055, enabled = true }) {
  const audio = document.createElement("audio");
  audio.src = source;
  audio.loop = true;
  audio.preload = "none";
  audio.volume = Math.min(1, Math.max(0, Number(volume) || 0.055));
  audio.setAttribute("aria-hidden", "true");

  let soundEnabled = Boolean(enabled);
  let hasInteracted = false;
  let destroyed = false;

  async function play() {
    hasInteracted = true;
    if (!soundEnabled || destroyed || document.hidden) return false;
    try {
      await audio.play();
      return true;
    } catch (_error) {
      return false;
    }
  }

  function pause() {
    audio.pause();
  }

  function setEnabled(nextEnabled) {
    soundEnabled = Boolean(nextEnabled);
    if (!soundEnabled) pause();
    else if (hasInteracted) void play();
  }

  function handleInteraction() {
    hasInteracted = true;
    if (soundEnabled) void play();
  }

  function handleVisibilityChange() {
    if (document.hidden) pause();
    else if (soundEnabled && hasInteracted) void play();
  }

  document.addEventListener("pointerdown", handleInteraction, { capture: true });
  document.addEventListener("keydown", handleInteraction, { capture: true });
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return Object.freeze({
    get enabled() { return soundEnabled; },
    play,
    pause,
    setEnabled,
    destroy() {
      destroyed = true;
      pause();
      audio.removeAttribute("src");
      audio.load();
      document.removeEventListener("pointerdown", handleInteraction, { capture: true });
      document.removeEventListener("keydown", handleInteraction, { capture: true });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    },
  });
}

export function attachBackgroundMusic({ source, button, label, volume = 0.055 }) {
  let enabled = readSoundPreference();
  const player = createBackgroundMusic({ source, volume, enabled });

  function render() {
    button?.setAttribute("aria-pressed", String(enabled));
    if (button) button.title = enabled ? "배경 음악 끄기" : "배경 음악 켜기";
    if (label) label.textContent = enabled ? "음악 켜짐" : "음악 꺼짐";
  }

  function setEnabled(nextEnabled) {
    enabled = Boolean(nextEnabled);
    saveSoundPreference(enabled);
    player.setEnabled(enabled);
    render();
  }

  function handleToggle() {
    setEnabled(!enabled);
  }

  button?.addEventListener("click", handleToggle);
  window.addEventListener("pagehide", player.destroy, { once: true });
  render();

  return Object.freeze({
    get enabled() { return enabled; },
    setEnabled,
    destroy() {
      button?.removeEventListener("click", handleToggle);
      player.destroy();
    },
  });
}
