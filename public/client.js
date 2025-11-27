const statusEl = document.getElementById("status");
const inputEl = document.getElementById("packetInput");
const sendBtn = document.getElementById("sendBtn");

// Connect to WebSocket on same host/port
const wsUrl = `ws://${location.host}`;
const ws = new WebSocket(wsUrl);

ws.onopen = () => {
  statusEl.textContent = `Connected to ${wsUrl}`;
  console.log("WS connected");
};

ws.onclose = () => {
  statusEl.textContent = "Disconnected";
  console.log("WS disconnected");
};

ws.onerror = (e) => {
  statusEl.textContent = "WebSocket error";
  console.error("WS error", e);
};

ws.onmessage = (evt) => {
  try {
    const msg = JSON.parse(evt.data);
    if (msg.ok) {
      console.log("AI reply:", msg.reply);
    } else {
      console.error("AI error:", msg.error);
    }
  } catch (e) {
    console.log("Raw message:", evt.data);
  }
};

sendBtn.onclick = () => {
  const packetText = inputEl.value.trim();
  if (!packetText) return;

  console.log("Sending packet to AI...");
  ws.send(packetText);
};
