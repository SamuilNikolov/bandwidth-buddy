# Packet Analyzer - Network Security Monitor

A real-time network packet analyzer with AI-powered threat evaluation. This system uses Scapy to capture network packets and provides a Wireshark-like interface with AI evaluation capabilities.

## Features

- **Real-time Packet Capture**: Uses Scapy to sniff network packets continuously
- **WebSocket Filtering**: Automatically filters out the project's own WebSocket traffic
- **Wireshark-like UI**: Clean, modern interface with packet list and detailed views
- **AI Evaluation**: Evaluate packets with context (10 packets before/after) using Ollama
- **Threat Analysis**: Get AI-powered risk assessment and intent analysis for each packet

## Architecture

- **Python Flask Server** (`packet_sniffer.py`): Handles packet capture with Scapy and serves packet data via REST API
- **Node.js Express Server** (`server.js`): Main web server that proxies requests and handles AI evaluation
- **Frontend** (`public/packet-analyzer.html`): Modern UI for viewing and evaluating packets

## Prerequisites

- Python 3.8+
- Node.js 16+
- Ollama installed and running (for AI evaluation)
- Administrator/root privileges (for packet capture)

## Installation

1. **Install Python dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Install Node.js dependencies:**
   ```bash
   npm install
   ```

3. **Set up Ollama** (if not already installed):
   - Install Ollama from https://ollama.ai
   - Pull a model: `ollama pull run gemma3:4b` (or your preferred model)
   - Update the model name in `server.js` if using a different model

## Running the System

### 1. Start the Python Packet Sniffer

**On Linux/Mac (requires sudo):**
```bash
sudo python3 packet_sniffer.py
```

**On Windows (run as Administrator):**
```bash
python packet_sniffer.py
```

The Python server will start on `http://localhost:5000`

### 2. Start the Node.js Server

```bash
npm start
```

The web server will start on `http://localhost:5173`

### 3. Open the Packet Analyzer

Navigate to: `http://localhost:5173/packet-analyzer.html`

## Usage

1. **Start Monitoring**: Click the "Start Monitoring" button to begin capturing packets
2. **View Packets**: Packets will appear in real-time in the main panel
3. **Expand Details**: Click the "▼" button on any packet to see detailed information
4. **Evaluate Packet**: Click "Evaluate" on any packet to get AI-powered threat analysis
5. **View Evaluation**: The right sidebar shows the last evaluated packet and its AI analysis

## Configuration

### Environment Variables

- `OLLAMA_URL`: Ollama API URL (default: `http://127.0.0.1:11434`)
- `PORT`: Node.js server port (default: `5173`)
- `PYTHON_SNIFFER_URL`: Python sniffer URL (default: `http://localhost:5000`)

### Model Configuration

Edit `server.js` to change the AI model:
```javascript
model: "run gemma3:4b", // Change to your preferred model
```

## Packet Information Captured

Each packet includes:
- Unique ID
- Timestamp
- Protocol (TCP, UDP, ICMP, ARP, IPv6, etc.)
- Source and destination IP addresses
- Source and destination ports (if applicable)
- Packet size
- TCP flags (if applicable)
- Payload preview and full payload (hex)
- Full packet hex dump

## AI Evaluation

When evaluating a packet, the AI receives:
- The target packet with all its details
- 10 packets before the target packet (context)
- 10 packets after the target packet (context)

The AI provides:
- Severity level (low/medium/high)
- Threat level assessment
- Intent analysis (what the connection is trying to do)
- Rationale and recommendations

## Troubleshooting

### No packets appearing
- Ensure you have administrator/root privileges
- Check that the Python sniffer is running
- Verify network interface permissions

### Evaluation fails
- Ensure Ollama is running: `ollama serve`
- Check that the model is pulled: `ollama list`
- Verify the model name in `server.js` matches your installed model

### Permission errors on Linux/Mac
- Run the Python script with `sudo`
- On some systems, you may need to install additional network capture tools

## Security Note

This tool captures network traffic. Use responsibly and only on networks you own or have permission to monitor.


