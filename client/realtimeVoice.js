export function getRealtimeSupport() {
  const hasMic =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices) &&
    typeof navigator.mediaDevices.getUserMedia === "function";

  return {
    microphone: hasMic,
    webrtc: typeof window !== "undefined" && typeof window.RTCPeerConnection === "function",
    ready: hasMic && typeof window !== "undefined" && typeof window.RTCPeerConnection === "function",
  };
}

export async function createRealtimeCoach({
  token,
  mode,
  topic,
  learnerLevel,
  userName,
  onStatus,
  onMessage,
  onTranscriptComplete,
  onError,
}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const peer = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;

  stream.getTracks().forEach((track) => peer.addTrack(track, stream));
  peer.ontrack = (event) => {
    audio.srcObject = event.streams[0];
  };

  const channel = peer.createDataChannel("oai-events");
  const partials = new Map();

  channel.onopen = () => {
    onStatus?.("connected");
    channel.send(
      JSON.stringify({
        type: "response.create",
        response: {
          instructions: "Greet the learner as Verbix and begin the speaking practice.",
          modalities: ["audio", "text"],
        },
      })
    );
  };

  channel.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);

      if (payload.type === "input_audio_buffer.speech_started") {
        onStatus?.("listening");
        return;
      }

      if (payload.type === "input_audio_buffer.speech_stopped") {
        onStatus?.("processing");
        return;
      }

      if (payload.type === "response.output_text.delta") {
        const key = payload.response_id || "assistant";
        partials.set(key, `${partials.get(key) || ""}${payload.delta}`);
        return;
      }

      if (payload.type === "response.output_text.done") {
        const key = payload.response_id || "assistant";
        const text = (partials.get(key) || payload.text || "").trim();
        partials.delete(key);
        if (text) {
          onMessage?.({ role: "assistant", text });
        }
        onStatus?.("live");
        return;
      }

      if (payload.type === "conversation.item.input_audio_transcription.completed" && payload.transcript?.trim()) {
        const transcript = payload.transcript.trim();
        onMessage?.({ role: "system", text: `You said: ${transcript}` });
        Promise.resolve(onTranscriptComplete?.(transcript, dataSessionId)).catch((error) => {
          onError?.(`Live scoring error: ${error.message}`);
        });
      }
    } catch (error) {
      onError?.(`Realtime event error: ${error.message}`);
    }
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  const response = await fetch("/api/realtime/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      sdp: offer.sdp,
      mode,
      topic,
      learnerLevel,
      userName,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.detail || "Failed to connect Verbix realtime voice.");
  }

  const dataSessionId = data.sessionId;
  await peer.setRemoteDescription({ type: "answer", sdp: data.sdp });
  onStatus?.("live");

  return {
    model: data.model,
    sessionId: dataSessionId,
    stop() {
      try {
        channel.close();
      } catch (error) {
        // Ignore close races.
      }
      peer.getSenders().forEach((sender) => sender.track?.stop());
      stream.getTracks().forEach((track) => track.stop());
      peer.close();
      audio.srcObject = null;
      onStatus?.("stopped");
    },
  };
}
