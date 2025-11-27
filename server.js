import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const PYTHON_SNIFFER_URL = process.env.PYTHON_SNIFFER_URL || "http://localhost:5000";

// Chat session configuration
const CHAT_SESSION_TTL = 3600000; // 1 hour in milliseconds (sessions expire after 1 hour of inactivity)

/**
 * Enhanced prompt for packet evaluation with context
 */
const SYSTEM_PROMPT = `
You are a network security analyst. Evaluate ONLY the TARGET PACKET marked in the input. Other packets are context only.

REQUIRED RESPONSE FORMAT (you MUST include all these fields in this order):

PACKET_IDENTIFICATION: Evaluating Packet ID: [id], Protocol: [protocol], Source: [src]:[port], Destination: [dst]:[port], Timestamp: [time]

SEVERITY: [number 0-100]
(0 = harmless, 100 = extremely dangerous/threatening)
YOU NEED TO PROVIDE SEVERITY AS A PERCENTAGE BETWEEN 0 AND 100 (ONLY THE NUMBER, NO OTHER TEXT)
CONFIDENCE: [number 0-100]
YOU NEED TO PROVIDE CONFIDENCE AS A PERCENTAGE BETWEEN 0 AND 100 (ONLY THE NUMBER, NO OTHER TEXT)
(0 = uncertain, 100 = completely certain)

DO NOT USE ANY LANGUAGE THAT IS NOT ENGLISH

RATIONALE: [3-4 sentences justifying your severity and confidence ratings, explaining what the connection might serve, and potential further action]

CRITICAL REQUIREMENTS:
- SEVERITY and CONFIDENCE MUST be the FIRST two fields after PACKET_IDENTIFICATION
- Both must be numeric values 0-100 (not words like "low" or "high")
- ABSOLUTELY NO MARKDOWN - NO ASTERISKS (*) ANYWHERE in your response
- Use plain text only with field names in ALL CAPS followed by a colon
`;

/**
 * System prompt for follow-up questions (more conversational)
 * This prompt is persistent - sent once when switching to chat mode, then maintained in session
 */
const CHAT_SYSTEM_PROMPT = `
You are a network security analyst helping a user understand a packet evaluation. 
You have already evaluated a packet and provided an initial assessment.

CRITICAL RESTRICTION: You MUST ONLY respond to questions about cybersecurity, network security, packet analysis, threat assessment, and related security topics. 

If the user asks about anything unrelated to cybersecurity or network security (e.g., general computing, unrelated topics, personal questions, etc.), politely decline and redirect them to ask about the packet's security implications instead.

The user may ask follow-up questions about:
- The packet's threat level and why
- What the packet might be doing from a security perspective
- Security recommendations for further action
- Technical security details about the packet
- Comparison with other packets from a security standpoint
- Potential vulnerabilities or attack vectors
- Network security best practices related to this packet

Answer their questions clearly and concisely, referencing the packet details when relevant.
You can reference the initial evaluation if needed, but focus on answering the current question.

Remember: ONLY answer cybersecurity and network security questions. Decline all other topics.
`;

/**
 * Chat Session Manager - maintains separate chat sessions per packet ID
 * No maximum limit - sessions are only cleaned up by TTL (time-based expiration)
 * Includes context window management to prevent system prompt from being lost
 */
class ChatSessionManager {
  constructor(ttl = CHAT_SESSION_TTL) {
    this.sessions = new Map(); // packetId -> { messages: [], createdAt: timestamp, lastAccess: timestamp }
    this.ttl = ttl;
    // Conservative estimate: ~4 chars per token, most models have 4K-8K token context
    // Using 6000 tokens as safe limit (gemma3:4b typically has 8K context)
    this.maxContextTokens = 6000;
    this.charsPerToken = 4; // Rough estimate
    
    // Cleanup old sessions every 5 minutes
    setInterval(() => this.cleanupOldSessions(), 300000);
  }
  
  /**
   * Estimate token count from character count
   */
  estimateTokens(text) {
    return Math.ceil(text.length / this.charsPerToken);
  }
  
  /**
   * Get total estimated tokens in a message array
   */
  getTotalTokens(messages) {
    let total = 0;
    for (const msg of messages) {
      total += this.estimateTokens(JSON.stringify(msg));
    }
    return total;
  }
  
  /**
   * Trim messages to fit context window while preserving system prompt
   */
  trimToContextWindow(messages) {
    if (!messages || messages.length === 0) return messages;
    
    // Always keep system prompt (first message)
    const systemPrompt = messages[0];
    const otherMessages = messages.slice(1);
    
    // Calculate system prompt tokens
    const systemTokens = this.estimateTokens(JSON.stringify(systemPrompt));
    const availableTokens = this.maxContextTokens - systemTokens - 500; // Reserve 500 tokens for response
    
    // If system prompt alone exceeds limit, return just system prompt
    if (systemTokens > this.maxContextTokens - 500) {
      console.warn(`[ChatSession] System prompt is very large (${systemTokens} tokens), may exceed context window`);
      return [systemPrompt];
    }
    
    // Try to fit as many recent messages as possible
    let totalTokens = 0;
    const trimmedMessages = [systemPrompt];
    
    // Add messages from newest to oldest until we hit the limit
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const msgTokens = this.estimateTokens(JSON.stringify(msg));
      
      if (totalTokens + msgTokens <= availableTokens) {
        trimmedMessages.push(msg);
        totalTokens += msgTokens;
      } else {
        // Can't fit this message, stop
        break;
      }
    }
    
    // Reverse to get chronological order (system, then oldest to newest)
    trimmedMessages[0] = systemPrompt; // Keep system first
    const result = [systemPrompt, ...trimmedMessages.slice(1).reverse()];
    
    if (messages.length !== result.length) {
      console.log(`[ChatSession] Trimmed ${messages.length} messages to ${result.length} to fit context window (${this.getTotalTokens(result)} tokens)`);
    }
    
    return result;
  }

  /**
   * Get or create a chat session for a packet
   */
  getSession(packetId) {
    const session = this.sessions.get(packetId);
    
    // Check if expired
    if (session && Date.now() - session.lastAccess > this.ttl) {
      this.sessions.delete(packetId);
      return null;
    }
    
    return session;
  }

  /**
   * Create a new chat session for a packet
   * No maximum limit - sessions only expire by TTL
   */
  createSession(packetId, initialSystemPrompt = SYSTEM_PROMPT) {
    const session = {
      messages: [
        { role: "system", content: initialSystemPrompt.trim() }
      ],
      createdAt: Date.now(),
      lastAccess: Date.now(),
      packetId: packetId
    };
    
    this.sessions.set(packetId, session);
    console.log(`[ChatSession] Created new session for packet ${packetId} (total sessions: ${this.sessions.size})`);
    return session;
  }

  /**
   * Add a message to a chat session
   */
  addMessage(packetId, role, content, systemPrompt = null) {
    let session = this.getSession(packetId);
    
    if (!session) {
      // Create new session with appropriate system prompt
      const prompt = systemPrompt || (role === "user" && !this.sessions.has(packetId) ? SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT);
      session = this.createSession(packetId, prompt);
    }
    
    session.messages.push({ role, content });
    session.lastAccess = Date.now();
    
    return session;
  }

  /**
   * Get all messages for a chat session
   * Automatically trims to context window if needed
   */
  getMessages(packetId) {
    const session = this.getSession(packetId);
    if (!session) return null;
    
    // Check if we need to trim
    const totalTokens = this.getTotalTokens(session.messages);
    if (totalTokens > this.maxContextTokens) {
      console.log(`[ChatSession] Context window exceeded (${totalTokens} tokens), trimming for packet ${packetId}`);
      session.messages = this.trimToContextWindow(session.messages);
    }
    
    return session.messages;
  }

  /**
   * Cleanup expired sessions
   */
  cleanupOldSessions() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [packetId, session] of this.sessions.entries()) {
      if (now - session.lastAccess > this.ttl) {
        this.sessions.delete(packetId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[ChatSession] Cleaned up ${cleaned} expired sessions (remaining: ${this.sessions.size})`);
    }
  }

  /**
   * Get memory usage statistics
   * This memory represents the chat context/history stored in RAM
   */
  getStats() {
    let totalMessages = 0;
    let totalChars = 0;
    
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
      for (const msg of session.messages) {
        totalChars += JSON.stringify(msg).length;
      }
    }
    
    // Rough estimate: each character is ~1 byte, plus Map overhead
    const estimatedMemoryBytes = totalChars + (this.sessions.size * 200); // ~200 bytes overhead per session
    
    return {
      activeSessions: this.sessions.size,
      totalMessages: totalMessages,
      estimatedMemoryMB: (estimatedMemoryBytes / 1024 / 1024).toFixed(2),
      estimatedMemoryKB: (estimatedMemoryBytes / 1024).toFixed(2),
      description: "Chat context memory - stores conversation history for each packet evaluation"
    };
  }

  /**
   * Clear a specific session
   */
  clearSession(packetId) {
    const deleted = this.sessions.delete(packetId);
    if (deleted) {
      console.log(`[ChatSession] Cleared session for packet ${packetId}`);
    }
    return deleted;
  }
}

// Initialize chat session manager (no max limit - only TTL cleanup)
const chatManager = new ChatSessionManager();

/**
 * Format packet information for AI analysis
 * @param {Object} packet - Packet object
 * @param {boolean} isTarget - If true, include full details; if false, limit data for context
 */
function formatPacketForAI(packet, isTarget = false) {
  const parts = [];
  parts.push(`Packet ID: ${packet.id}`);
  parts.push(`Protocol: ${packet.protocol}`);
  parts.push(`Source: ${packet.src_ip || 'N/A'}:${packet.src_port || 'N/A'}`);
  parts.push(`Destination: ${packet.dst_ip || 'N/A'}:${packet.dst_port || 'N/A'}`);
  parts.push(`Size: ${packet.size} bytes`);
  if (packet.flags) parts.push(`Flags: ${packet.flags}`);
  
  if (isTarget) {
    // Full details for target packet
    if (packet.payload_preview) {
      parts.push(`Payload Preview: ${packet.payload_preview}`);
    }
    if (packet.raw_data) {
      // Limit raw_data to 500 chars to avoid huge payloads
      const rawDataPreview = packet.raw_data.length > 500 
        ? packet.raw_data.substring(0, 500) + '...' 
        : packet.raw_data;
      parts.push(`Payload: ${rawDataPreview}`);
    }
    if (packet.summary) parts.push(`Summary: ${packet.summary}`);
  } else {
    // Reduced details for context packets (just essentials)
    if (packet.summary) parts.push(`Summary: ${packet.summary}`);
  }
  
  return parts.join('\n');
}

/**
 * Validate that AI response contains required fields
 */
function validateEvaluationResponse(response) {
  if (!response || typeof response !== 'string') {
    return { valid: false, error: 'Empty or invalid response', fullResponse: response };
  }
  
  // More flexible matching - handle various formats:
  // - PACKET_IDENTIFICATION: (with underscore)
  // - PACKET IDENTIFICATION: (with space)
  // - **PACKET IDENTIFICATION**: (markdown)
  // - **PACKET_IDENTIFICATION**: (markdown with underscore)
  const hasPacketId = /PACKET[\s_]*IDENTIFICATION[:\s*]/i.test(response) || 
                      /\*\*PACKET[\s_]*IDENTIFICATION\*\*/i.test(response) ||
                      /PACKET[\s_]*ID[:\s*]/i.test(response);
  
  // Check for SEVERITY with a number - handle various formats including markdown:
  // - SEVERITY: 45
  // - SEVERITY: 45%
  // - **SEVERITY**: 10 (Low) - extract the number 10
  // - SEVERITY 45 (without colon)
  // Match pattern: SEVERITY (possibly with **) followed by colon/space and a number
  const severityMatch = response.match(/\*\*SEVERITY\*\*\s*:\s*(\d+)/i) ||  // **SEVERITY**: 10
                        response.match(/SEVERITY\s*:\s*(\d+)/i) ||              // SEVERITY: 45
                        response.match(/\*\*SEVERITY\*\*\s+(\d+)/i) ||          // **SEVERITY** 10
                        response.match(/SEVERITY\s+(\d+)/i);                    // SEVERITY 45
  const hasSeverity = severityMatch !== null;
  
  // Check for CONFIDENCE with a number - handle various formats including markdown:
  // - CONFIDENCE: 75
  // - CONFIDENCE: 75%
  // - **CONFIDENCE**: 95% - extract the number 95
  // - CONFIDENCE 75 (without colon)
  // Match pattern: CONFIDENCE (possibly with **) followed by colon/space and a number
  const confidenceMatch = response.match(/\*\*CONFIDENCE\*\*\s*:\s*(\d+)/i) ||  // **CONFIDENCE**: 95
                          response.match(/CONFIDENCE\s*:\s*(\d+)/i) ||           // CONFIDENCE: 75
                          response.match(/\*\*CONFIDENCE\*\*\s+(\d+)/i) ||        // **CONFIDENCE** 95
                          response.match(/CONFIDENCE\s+(\d+)/i);                  // CONFIDENCE 75
  const hasConfidence = confidenceMatch !== null;
  
  if (!hasPacketId) {
    return { 
      valid: false, 
      error: 'Missing PACKET_IDENTIFICATION field (or PACKET IDENTIFICATION with space)',
      fullResponse: response
    };
  }
  
  if (!hasSeverity) {
    return { 
      valid: false, 
      error: 'Missing SEVERITY field with numeric value (must be format: SEVERITY: 45, not SEVERITY: description). Found variations but no number.',
      fullResponse: response
    };
  }
  
  if (!hasConfidence) {
    return { 
      valid: false, 
      error: 'Missing CONFIDENCE field with numeric value (must be format: CONFIDENCE: 75, not CONFIDENCE: description). Found variations but no number.',
      fullResponse: response
    };
  }
  
  return { valid: true };
}

/**
 * Call Ollama /api/chat for packet evaluation with context
 * Now uses persistent chat sessions per packet ID
 */
async function evaluatePacketWithContext(targetPacket, contextPackets) {
  const packetId = targetPacket.id;
  
  // Build context string
  const contextParts = [];
  contextParts.push("=== PACKET CONTEXT ===");
  contextParts.push(`Analyzing packet ${targetPacket.id} with ${contextPackets.length - 1} surrounding packets.\n`);
  
  contextParts.push("=== PACKETS BEFORE (CONTEXT ONLY) ===");
  const targetIndex = contextPackets.findIndex(p => p.id === targetPacket.id);
  if (targetIndex > 0) {
    contextPackets.slice(0, targetIndex).forEach((pkt, idx) => {
      contextParts.push(`\n[Before ${idx + 1}]`);
      contextParts.push(formatPacketForAI(pkt, false)); // false = context packet, reduced data
    });
  }
  
  contextParts.push("\n=== TARGET PACKET (EVALUATE THIS ONE ONLY) ===");
  contextParts.push(formatPacketForAI(targetPacket, true)); // true = target packet, full details
  contextParts.push(`Timestamp: ${targetPacket.timestamp}`);
  
  contextParts.push("\n=== PACKETS AFTER (CONTEXT ONLY) ===");
  if (targetIndex < contextPackets.length - 1) {
    contextPackets.slice(targetIndex + 1).forEach((pkt, idx) => {
      contextParts.push(`\n[After ${idx + 1}]`);
      contextParts.push(formatPacketForAI(pkt, false)); // false = context packet, reduced data
    });
  }
  
  const fullContext = contextParts.join('\n');
  const userMessage = fullContext + "\n\nEvaluate ONLY the TARGET PACKET. Format: PACKET_IDENTIFICATION: [details], SEVERITY: [number], CONFIDENCE: [number]. NO MARKDOWN, NO ASTERISKS (**).";
  
  // Get or create chat session for this packet
  let messages = chatManager.getMessages(packetId);
  if (!messages) {
    // First evaluation - create new session with evaluation system prompt
    chatManager.createSession(packetId, SYSTEM_PROMPT);
    messages = chatManager.getMessages(packetId);
  }
  
  // Add user message to session
  chatManager.addMessage(packetId, "user", userMessage);
  messages = chatManager.getMessages(packetId);
  
  const body = {
    model: "gemma3:4b", // <<< change to whatever you have pulled
    stream: false,
    messages: messages
  };

  // Console log what's being sent to AI
  console.log(`=== SENDING TO AI FOR EVALUATION (Packet ${packetId}) ===`);
  console.log(`Chat session: ${messages.length} messages`);
  console.log("Full Request Body:", JSON.stringify(body, null, 2));
  console.log("=====================================");

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Ollama error ${resp.status}`);
  }

  const data = await resp.json();
  const response = data?.message?.content ?? "";
  
  // Add AI response to chat session
  chatManager.addMessage(packetId, "assistant", response);
  
  // Validate response format (only for first evaluation)
  if (messages.length === 3) { // system + user + assistant (first evaluation)
    const validation = validateEvaluationResponse(response);
    if (!validation.valid) {
      const fullResponse = validation.fullResponse || response;
      throw new Error(`AI response validation failed: ${validation.error}.\n\nThe model did not follow the required format.\n\nFull response received:\n${fullResponse}\n\nExpected format:\nPACKET_IDENTIFICATION: [details]\nSEVERITY: [number 0-100]\nCONFIDENCE: [number 0-100]\n[other fields...]`);
    }
  }
  
  return response;
}

/**
 * Legacy function for single packet evaluation (backward compatibility)
 */
async function evaluatePacket(packetText) {
  const body = {
    model: "gemma3:4b",
    stream: false,
    messages: [
      { role: "system", content: SYSTEM_PROMPT.trim() },
      { role: "user", content: packetText + "\n\nFormat: PACKET_IDENTIFICATION: [details], SEVERITY: [number], CONFIDENCE: [number]. NO MARKDOWN, NO ASTERISKS (**)." }
    ]
  };

  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Ollama error ${resp.status}`);
  }

  const data = await resp.json();
  const response = data?.message?.content ?? "";
  
  // Validate response format
  const validation = validateEvaluationResponse(response);
  if (!validation.valid) {
    const fullResponse = validation.fullResponse || response;
    throw new Error(`AI response validation failed: ${validation.error}.\n\nThe model did not follow the required format.\n\nFull response received:\n${fullResponse}\n\nExpected format:\nPACKET_IDENTIFICATION: [details]\nSEVERITY: [number 0-100]\nCONFIDENCE: [number 0-100]\n[other fields...]`);
  }
  
  return response;
}

/**
 * API endpoint to evaluate a packet with context
 */
app.post("/api/evaluate", async (req, res) => {
  try {
    const { packetId, before = 5, after = 5 } = req.body;
    
    if (!packetId) {
      return res.status(400).json({ error: "packetId is required" });
    }
    
    // Fetch packet context from Python sniffer
    const contextResp = await fetch(
      `${PYTHON_SNIFFER_URL}/api/packets/${packetId}/context?before=${before}&after=${after}`
    );
    
    if (!contextResp.ok) {
      return res.status(404).json({ error: "Packet not found" });
    }
    
    const contextData = await contextResp.json();
    const contextPackets = contextData.packets || [];
    
    if (contextPackets.length === 0) {
      return res.status(404).json({ error: "Packet context not found" });
    }
    
    // Find target packet
    const targetPacket = contextPackets.find(p => p.id === packetId);
    if (!targetPacket) {
      return res.status(404).json({ error: "Target packet not found in context" });
    }
    
    // Evaluate with AI (creates or uses existing chat session)
    const evaluation = await evaluatePacketWithContext(targetPacket, contextPackets);
    
    res.json({
      ok: true,
      packetId: packetId,
      evaluation: evaluation,
      packet: targetPacket
    });
  } catch (err) {
    console.error("Evaluation error:", err);
    res.status(500).json({
      ok: false,
      error: String(err)
    });
  }
});

/**
 * API endpoint for follow-up questions in chat
 */
app.post("/api/chat/ask", async (req, res) => {
  try {
    const { packetId, question } = req.body;
    
    if (!packetId) {
      return res.status(400).json({ error: "packetId is required" });
    }
    
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ error: "question is required and must be a non-empty string" });
    }
    
    // Check if chat session exists (packet must have been evaluated first)
    let messages = chatManager.getMessages(packetId);
    if (!messages) {
      return res.status(404).json({ 
        error: "Chat session not found. Please evaluate the packet first." 
      });
    }
    
    // Switch to chat system prompt if this is the first follow-up
    // (messages.length === 3 means: system + user (evaluation) + assistant (evaluation response))
    if (messages.length === 3) {
      // Replace system prompt with chat prompt for follow-ups
      messages[0] = { role: "system", content: CHAT_SYSTEM_PROMPT.trim() };
      console.log(`[ChatSession] Switched to chat mode for packet ${packetId}`);
    }
    
    // Add user question
    chatManager.addMessage(packetId, "user", question.trim());
    messages = chatManager.getMessages(packetId);
    
    // Call Ollama
    const body = {
      model: "gemma3:4b",
      stream: false,
      messages: messages
    };
    
    console.log(`=== CHAT QUESTION FOR PACKET ${packetId} ===`);
    console.log(`Question: ${question}`);
    console.log(`Chat history: ${messages.length} messages`);
    
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `Ollama error ${resp.status}`);
    }
    
    const data = await resp.json();
    const response = data?.message?.content ?? "";
    
    // Add AI response to chat session
    chatManager.addMessage(packetId, "assistant", response);
    
    res.json({
      ok: true,
      packetId: packetId,
      answer: response
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({
      ok: false,
      error: String(err)
    });
  }
});

/**
 * API endpoint to get chat history for a packet
 */
app.get("/api/chat/:packetId", (req, res) => {
  try {
    const { packetId } = req.params;
    const messages = chatManager.getMessages(packetId);
    
    if (!messages) {
      return res.status(404).json({ error: "Chat session not found" });
    }
    
    // Return messages without system prompt for frontend display
    const chatMessages = messages.slice(1).map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    res.json({
      ok: true,
      packetId: packetId,
      messages: chatMessages
    });
  } catch (err) {
    console.error("Error getting chat history:", err);
    res.status(500).json({
      ok: false,
      error: String(err)
    });
  }
});

/**
 * API endpoint to get memory usage statistics
 */
app.get("/api/memory", async (req, res) => {
  try {
    const stats = chatManager.getStats();
    
    // Get Node.js process memory
    const processMemory = process.memoryUsage();
    
    // Try to get Ollama model memory info
    let ollamaMemory = null;
    try {
      const ollamaResp = await fetch(`${OLLAMA_URL}/api/ps`);
      if (ollamaResp.ok) {
        const ollamaData = await ollamaResp.json();
        if (ollamaData.models && ollamaData.models.length > 0) {
          // Calculate total VRAM used by models
          let totalVRAM = 0;
          ollamaData.models.forEach(model => {
            totalVRAM += model.size_vram || 0;
          });
          
          // Try to get GPU info to determine total VRAM
          // Note: This requires Ollama to expose GPU info, which may not be available
          let totalAvailableVRAM = null;
          if (ollamaData.gpus && ollamaData.gpus.length > 0) {
            // Sum up total VRAM from all GPUs
            totalAvailableVRAM = ollamaData.gpus.reduce((sum, gpu) => {
              return sum + (gpu.total_memory || 0);
            }, 0);
          }
          
          ollamaMemory = {
            models: ollamaData.models.map(m => ({
              name: m.name,
              size_vram_mb: ((m.size_vram || 0) / 1024 / 1024).toFixed(2)
            })),
            total_vram_mb: (totalVRAM / 1024 / 1024).toFixed(2),
            total_available_vram_mb: totalAvailableVRAM ? (totalAvailableVRAM / 1024 / 1024).toFixed(2) : null,
            gpus: ollamaData.gpus || []
          };
        }
      }
    } catch (err) {
      console.log("Could not fetch Ollama memory info:", err.message);
    }
    
    // Try to get system memory info (OS-level)
    let systemMemory = null;
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      systemMemory = {
        total_gb: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        used_gb: (usedMem / 1024 / 1024 / 1024).toFixed(2),
        free_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2),
        usage_percent: ((usedMem / totalMem) * 100).toFixed(1)
      };
    } catch (err) {
      console.log("Could not get system memory info:", err.message);
    }
    
    res.json({
      ok: true,
      chatSessions: stats,
      processMemory: {
        rss: (processMemory.rss / 1024 / 1024).toFixed(2), // Resident Set Size (MB)
        heapTotal: (processMemory.heapTotal / 1024 / 1024).toFixed(2), // Total heap (MB)
        heapUsed: (processMemory.heapUsed / 1024 / 1024).toFixed(2), // Used heap (MB)
        external: (processMemory.external / 1024 / 1024).toFixed(2) // External (MB)
      },
      ollamaMemory: ollamaMemory,
      systemMemory: systemMemory
    });
  } catch (err) {
    console.error("Error getting memory stats:", err);
    res.status(500).json({
      ok: false,
      error: String(err)
    });
  }
});

/**
 * Proxy endpoint to get packets from Python sniffer
 */
app.get("/api/packets", async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const resp = await fetch(`${PYTHON_SNIFFER_URL}/api/packets?limit=${limit}`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    console.error("Error fetching packets:", err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * Proxy endpoint for monitoring control
 */
app.post("/api/monitoring/start", async (req, res) => {
  try {
    const resp = await fetch(`${PYTHON_SNIFFER_URL}/api/monitoring/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/monitoring/stop", async (req, res) => {
  try {
    const resp = await fetch(`${PYTHON_SNIFFER_URL}/api/monitoring/stop`, {
      method: "POST"
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/monitoring/status", async (req, res) => {
  try {
    const resp = await fetch(`${PYTHON_SNIFFER_URL}/api/monitoring/status`);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/**
 * HTTP server (for frontend)
 */
const port = process.env.PORT || 5173;
const httpServer = app.listen(port, () => {
  console.log(`UI: http://localhost:${port}`);
  console.log(`Python sniffer expected at: ${PYTHON_SNIFFER_URL}`);
});

/**
 * WebSocket server mounted on same HTTP server (for backward compatibility)
 */
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  console.log("WS client connected");

  ws.on("message", async (raw) => {
    const packet = raw.toString();
    console.log("Received packet:", packet);

    try {
      const aiReply = await evaluatePacket(packet);

      ws.send(JSON.stringify({
        ok: true,
        reply: aiReply
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        ok: false,
        error: String(err)
      }));
    }
  });

  ws.on("close", () => console.log("WS client disconnected"));
});
