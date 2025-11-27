# AI Integration Architecture Explanation

## Current Implementation Overview

The system uses **Ollama** (a local LLM server) via HTTP API calls. The following describes how the system works:

---

## 1. Model Loading

### How It Works Currently

**The model is NOT loaded by the Node.js application.** Instead:

1. **Ollama runs as a separate service** (typically started with `ollama serve`)
2. **Ollama loads the model** (`gemma3:4b`) when it starts or on first use
3. **The Node.js application makes HTTP requests** to Ollama's API endpoint (`http://127.0.0.1:11434/api/chat`)
4. **Each request is stateless** - you send a complete message array, Ollama processes it, and returns a response

### Model Lifecycle

```
┌─────────────────┐
│  Ollama Service │  ← Model loaded here (stays in memory)
│  (Separate)     │
└────────┬────────┘
         │ HTTP POST /api/chat
         │
┌────────▼────────┐
│  Node.js App    │  ← Sends HTTP requests
│  Application    │
└─────────────────┘
```

**Key Point:** The model stays loaded in Ollama's memory. The application does not manage model loading - it only sends HTTP requests.

---

## 2. Chat Session Handling

### Current Behavior: **NEW CHAT EVERY TIME**

Looking at `evaluatePacketWithContext()` (lines 147-214):

```javascript
const body = {
  model: "gemma3:4b",
  stream: false,
  messages: [
    { role: "system", content: SYSTEM_PROMPT.trim() },
    { role: "user", content: fullContext + "..." }
  ]
};
```

**Every evaluation creates a completely fresh chat session:**
- Each call to `/api/evaluate` creates a new `messages` array
- No conversation history is maintained
- No memory between evaluations
- Each packet evaluation is **completely independent**

### What This Means

```
Evaluation 1: [system prompt] → [user: packet 1 + context] → [AI response]
Evaluation 2: [system prompt] → [user: packet 2 + context] → [AI response]
Evaluation 3: [system prompt] → [user: packet 3 + context] → [AI response]
```

Each evaluation has **zero knowledge** of previous evaluations.

---

## 3. Context Passing (5 Messages Before/After)

### How Context is Built

In `evaluatePacketWithContext()` (lines 148-174):

1. **Fetches context packets** from Python sniffer (5 before + 5 after by default)
2. **Builds a single string** containing:
   - Packets before (reduced details)
   - Target packet (full details)
   - Packets after (reduced details)
3. **Sends everything in ONE user message**

### Context Structure

```
=== PACKET CONTEXT ===
Analyzing packet 123 with 10 surrounding packets.

=== PACKETS BEFORE (CONTEXT ONLY) ===
[Before 1] Packet ID: 118, Protocol: TCP, Source: 192.168.1.1:443...
[Before 2] Packet ID: 119, Protocol: TCP, Source: 192.168.1.1:443...
...
[Before 5] Packet ID: 122, Protocol: TCP, Source: 192.168.1.1:443...

=== TARGET PACKET (EVALUATE THIS ONE ONLY) ===
Packet ID: 123, Protocol: TCP, Source: 192.168.1.1:443...
[FULL DETAILS including payload, flags, etc.]

=== PACKETS AFTER (CONTEXT ONLY) ===
[After 1] Packet ID: 124, Protocol: TCP, Source: 192.168.1.1:443...
...
[After 5] Packet ID: 128, Protocol: TCP, Source: 192.168.1.1:443...
```

**Key Point:** All context is sent as a **single user message**, not separate messages. The AI sees it all at once.

---

## 4. System Prompt Usage

### Current Implementation

**The system prompt is sent with EVERY request** (line 180):

```javascript
messages: [
  { role: "system", content: SYSTEM_PROMPT.trim() },
  { role: "user", content: fullContext + "..." }
]
```

### How System Prompts Work

In the chat API format:
- **System message**: Sets the AI's role, behavior, and response format
- **User message**: The actual content/question
- **Assistant message**: The AI's response (not sent by you, returned by Ollama)

**Every evaluation includes:**
1. System prompt (instructions on how to respond)
2. User message (the packet data + context)

**Why this is necessary:** Since each evaluation is a new chat, the system prompt must be included every time to instruct the model on response format.

---

## 5. Design Options: Separate Chats Per Evaluation

### Current Design: Stateless

**Pros:**
- ✅ Simple - no state management
- ✅ Each evaluation is independent
- ✅ No memory leaks
- ✅ Easy to parallelize (can evaluate multiple packets simultaneously)
- ✅ Lower memory usage (no chat history stored)

**Cons:**
- ❌ No learning from previous evaluations
- ❌ System prompt sent every time (slight overhead)
- ❌ Can't reference previous packet analyses

### Alternative Design: Persistent Chat Sessions

For **separate chat sessions** (one per packet evaluation, maintained over time):

#### Option A: One Chat Per Packet ID

```javascript
// Store chat sessions in memory
const chatSessions = new Map(); // packetId → messages array

async function evaluatePacketWithContext(targetPacket, contextPackets) {
  const packetId = targetPacket.id;
  
  // Get or create chat session for this packet
  if (!chatSessions.has(packetId)) {
    chatSessions.set(packetId, [
      { role: "system", content: SYSTEM_PROMPT.trim() }
    ]);
  }
  
  const messages = chatSessions.get(packetId);
  
  // Add user message
  const fullContext = buildContextString(targetPacket, contextPackets);
  messages.push({ role: "user", content: fullContext });
  
  // Call Ollama
  const body = { model: "gemma3:4b", stream: false, messages };
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, { ... });
  const data = await resp.json();
  
  // Add AI response to chat history
  messages.push({ role: "assistant", content: data.message.content });
  
  return data.message.content;
}
```

**What this does:**
- First evaluation of packet 123: Creates new chat, sends system + user, gets response
- Second evaluation of packet 123: Uses existing chat, adds new user message, AI can reference previous conversation

**Pros:**
- ✅ AI can reference previous evaluations of the same packet
- ✅ System prompt only sent once per packet
- ✅ More natural conversation flow

**Cons:**
- ❌ Memory grows over time (need cleanup strategy)
- ❌ More complex state management
- ❌ May not be useful for packet analysis (packets are usually evaluated once)

#### Option B: One Chat Per Evaluation (Current, but with explicit session IDs)

This matches the current implementation, with optional session tracking:

```javascript
let sessionCounter = 0;

async function evaluatePacketWithContext(targetPacket, contextPackets) {
  const sessionId = `eval-${Date.now()}-${++sessionCounter}`;
  
  const messages = [
    { role: "system", content: SYSTEM_PROMPT.trim() },
    { role: "user", content: buildContextString(...) }
  ];
  
  // Log session ID for debugging
  console.log(`Starting evaluation session: ${sessionId}`);
  
  // ... rest of evaluation
}
```

This doesn't change functionality, just adds tracking.

---

## 6. Performance Implications

### Current Design (Stateless)

**Memory:**
- Node.js application: Minimal (just request/response data)
- Ollama: Model stays in memory (shared across all requests)
- **Total overhead per evaluation:** ~few KB (just the HTTP request/response)

**Speed:**
- Each evaluation: ~1-5 seconds (depends on model size and hardware)
- Can run evaluations in parallel (no shared state)
- No serialization/deserialization of chat history

**Scalability:**
- ✅ Can handle many concurrent evaluations
- ✅ No memory leaks from chat history
- ✅ Easy to add rate limiting

### Alternative Design (Persistent Chats)

**Memory:**
- Node.js application: Grows with number of unique packets evaluated
- Each chat session: ~1-10 KB (depending on message history)
- **Risk:** Memory leak if sessions never cleaned up

**Speed:**
- First evaluation: Same as current
- Subsequent evaluations: Slightly faster (system prompt cached in session)
- **But:** Must serialize/deserialize chat history

**Scalability:**
- ⚠️ Memory grows over time
- ⚠️ Need cleanup strategy (e.g., LRU cache, TTL)
- ⚠️ Harder to parallelize (need session locking)

---

## 7. Active vs Standby Chats

### How Ollama Works

**Important:** Ollama does not maintain "active" vs "standby" chats. The following describes actual behavior:

1. **Model is loaded once** in Ollama's memory (stays loaded)
2. **Each HTTP request is independent** - you send complete message history
3. **Ollama processes the request** and returns a response
4. **No state is maintained** on Ollama's side between requests

### Persistent Chat Implementation

If chat sessions are stored in the Node.js application:

```
┌─────────────────────────────────┐
│  Node.js App Memory             │
│                                 │
│  chatSessions Map:              │
│  ├─ packet-123: [msg1, msg2]   │  ← "Active" (in memory)
│  ├─ packet-124: [msg1, msg2]   │  ← "Active" (in memory)
│  └─ packet-125: [msg1]          │  ← "Active" (in memory)
│                                 │
│  All chats are "active"         │
│  (all loaded in memory)         │
└─────────────────────────────────┘
```

**There's no "standby" state** - if you store it, it's in memory. If you don't store it, it doesn't exist.

### Memory Management Strategies

For persistent chats with memory limits:

```javascript
// Option 1: LRU Cache (keep only N most recent)
const chatSessions = new Map();
const MAX_SESSIONS = 100;

function addSession(packetId, messages) {
  if (chatSessions.size >= MAX_SESSIONS) {
    // Remove oldest (first key)
    const firstKey = chatSessions.keys().next().value;
    chatSessions.delete(firstKey);
  }
  chatSessions.set(packetId, messages);
}

// Option 2: TTL (Time To Live)
const chatSessions = new Map();
const SESSION_TTL = 3600000; // 1 hour

function cleanupOldSessions() {
  const now = Date.now();
  for (const [packetId, session] of chatSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) {
      chatSessions.delete(packetId);
    }
  }
}
setInterval(cleanupOldSessions, 60000); // Clean every minute
```

---

## 8. Recommendations

### Use Case: Packet Analysis

**The stateless design is recommended** because:

1. **Packets are typically evaluated once** - no need for conversation history
2. **Each packet is independent** - previous evaluations don't inform current ones
3. **Performance is better** - no memory overhead, easy parallelization
4. **Simpler code** - less to maintain, fewer bugs

### When to Use Persistent Chats

Consider persistent chats if:
- You want the AI to learn from previous evaluations
- You're doing iterative analysis (e.g., "analyze this packet, then ask follow-up questions")
- You want to build a conversation history for users
- You're doing multi-turn conversations about the same packet

---

## 9. Technical Deep Dive: How Ollama Processes Requests

### Request Processing for `/api/chat`

```
1. The Node.js application sends HTTP POST:
   {
     "model": "gemma3:4b",
     "messages": [
       { "role": "system", "content": "..." },
       { "role": "user", "content": "..." }
     ]
   }

2. Ollama receives request:
   - Model is already loaded in memory (or loads it now)
   - Processes the ENTIRE messages array
   - Generates response based on all messages
   - Returns response

3. The application receives:
   {
     "message": {
       "role": "assistant",
       "content": "AI response here"
     }
   }

4. Connection closes - no state maintained
```

**Key Insight:** Ollama is **stateless** - it doesn't remember previous requests. You must send the complete conversation history in each request if you want context.

---

## 10. Example: How to Implement Separate Chats (If Needed)

Complete implementation for separate chat sessions:

```javascript
// Chat session manager
class ChatSessionManager {
  constructor(maxSessions = 100, ttl = 3600000) {
    this.sessions = new Map();
    this.maxSessions = maxSessions;
    this.ttl = ttl; // 1 hour default
  }

  getSession(packetId) {
    const session = this.sessions.get(packetId);
    
    // Check if expired
    if (session && Date.now() - session.lastAccess > this.ttl) {
      this.sessions.delete(packetId);
      return null;
    }
    
    return session;
  }

  createSession(packetId) {
    // Cleanup if needed
    if (this.sessions.size >= this.maxSessions) {
      const oldestKey = this.sessions.keys().next().value;
      this.sessions.delete(oldestKey);
    }
    
    const session = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT.trim() }
      ],
      createdAt: Date.now(),
      lastAccess: Date.now()
    };
    
    this.sessions.set(packetId, session);
    return session;
  }

  addMessage(packetId, role, content) {
    const session = this.getSession(packetId) || this.createSession(packetId);
    session.messages.push({ role, content });
    session.lastAccess = Date.now();
  }

  getMessages(packetId) {
    const session = this.getSession(packetId);
    return session ? session.messages : null;
  }
}

// Usage
const chatManager = new ChatSessionManager();

async function evaluatePacketWithContext(targetPacket, contextPackets) {
  const packetId = targetPacket.id;
  
  // Get existing session or create new one
  let messages = chatManager.getMessages(packetId);
  if (!messages) {
    chatManager.createSession(packetId);
    messages = chatManager.getMessages(packetId);
  }
  
  // Build context
  const fullContext = buildContextString(targetPacket, contextPackets);
  
  // Add user message
  chatManager.addMessage(packetId, "user", fullContext);
  messages = chatManager.getMessages(packetId);
  
  // Call Ollama
  const body = {
    model: "gemma3:4b",
    stream: false,
    messages: messages
  };
  
  const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  
  const data = await resp.json();
  const response = data?.message?.content ?? "";
  
  // Add AI response to session
  chatManager.addMessage(packetId, "assistant", response);
  
  return response;
}
```

---

## Summary

**Current System:**
- ✅ Model loaded once by Ollama (stays in memory)
- ✅ New chat created for every evaluation
- ✅ Context (5 before/after) sent as single user message
- ✅ System prompt sent with every request
- ✅ Stateless - no memory between evaluations
- ✅ Best for independent packet analysis

**Performance:**
- Fast, simple, scalable
- No memory leaks
- Easy to parallelize

**For separate chats:**
- Implement session management in Node.js
- Store message history in memory (with cleanup)
- System prompt only sent once per session
- More complex, but enables conversation history

