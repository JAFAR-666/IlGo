export function getVoiceSupport() {
  const recognitionCtor =
    typeof window !== "undefined"
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : null;

  return {
    microphone:
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices) &&
      typeof navigator.mediaDevices.getUserMedia === "function",
    recording: typeof window !== "undefined" && typeof window.MediaRecorder === "function",
    recognition: Boolean(recognitionCtor),
  };
}

export async function startVoiceCapture(callbacks) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  const state = {
    stream,
    recorder: null,
    recognition: null,
    transcript: "",
    interimTranscript: "",
    audioUrl: "",
  };

  if (typeof MediaRecorder === "function") {
    state.recorder = new MediaRecorder(stream);
    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });
    state.recorder.addEventListener("stop", () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      state.audioUrl = URL.createObjectURL(blob);
      callbacks.onAudioReady?.(state.audioUrl);
    });
    state.recorder.start();
  }

  const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (RecognitionCtor) {
    state.recognition = new RecognitionCtor();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = "en-US";
    state.recognition.maxAlternatives = 1;

    state.recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || "";
        if (event.results[index].isFinal) {
          finalTranscript += `${transcript} `;
        } else {
          interimTranscript += transcript;
        }
      }

      state.transcript = `${state.transcript} ${finalTranscript}`.trim();
      state.interimTranscript = interimTranscript.trim();

      callbacks.onTranscript?.(state.transcript);
      callbacks.onInterimTranscript?.(state.interimTranscript);
    };

    state.recognition.onerror = (event) => {
      callbacks.onError?.(event.error || "Speech recognition failed.");
    };

    state.recognition.start();
  }

  return state;
}

export async function stopVoiceCapture(capture) {
  if (!capture) {
    return {
      transcript: "",
      interimTranscript: "",
      audioUrl: "",
    };
  }

  if (capture.recognition) {
    try {
      capture.recognition.stop();
    } catch (error) {
      // Ignore browser race conditions when stop is called after recognition ends.
    }
  }

  const stopRecorder = new Promise((resolve) => {
    if (!capture.recorder || capture.recorder.state === "inactive") {
      resolve();
      return;
    }

    capture.recorder.addEventListener("stop", () => resolve(), { once: true });
    capture.recorder.stop();
  });

  await stopRecorder;

  capture.stream?.getTracks().forEach((track) => track.stop());

  return {
    transcript: capture.transcript,
    interimTranscript: capture.interimTranscript,
    audioUrl: capture.audioUrl,
  };
}
