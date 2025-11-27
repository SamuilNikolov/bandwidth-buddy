# AI Implementation Deep Dive - Complete Technical Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Ollama API Integration](#ollama-api-integration)
3. [Model Selection and Flexibility](#model-selection-and-flexibility)
4. [Context Window Management](#context-window-management)
5. [System Prompts and Instructions](#system-prompts-and-instructions)
6. [Chat Session Management](#chat-session-management)
7. [Application Layers](#application-layers)
8. [Prompt Engineering](#prompt-engineering)
9. [Future: Fine-Tuning and Training](#future-fine-tuning-and-training)
10. [Data Flow and Interfaces](#data-flow-and-interfaces)

---

## Architecture Overview

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                     │
│  (Frontend: HTML/CSS/JavaScript - packet-analyzer.html)    │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP/WebSocket
                        │ JSON Messages
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  Application Server Layer                    │
│         (Node.js/Express - server.js)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Chat Session Manager                                │  │
│  │  - Session Storage (Map<packetId, Session>)         │  │
│  │  - Context Window Management                         │  │
│  │  - Message History                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  API Endpoints                                        │  │
│  │  - /api/evaluate (packet evaluation)                 │  │
│  │  - /api/chat/ask (follow-up questions)               │  │
│  │  - /api/chat/:packetId (get history)                 │  │
│  │  - /api/memory (system stats)                         │  │
│  └──────────────────────────────────────────────────────┘  │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP REST API
                        │ POST /api/chat
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Ollama Service Layer                     │
│  (Separate Process - ollama serve)                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Model Runtime                                      │  │
│  │  - Model loaded in memory (VRAM/RAM)                │  │
│  │  - Context processing                               │  │
│  │  - Token generation                                 │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  API Endpoint: http://127.0.0.1:11434/api/chat      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Frontend (Client)**: User interface, packet display, chat interface
2. **Backend (Server)**: Session management, API routing, context management
3. **Ollama Service**: Model execution, inference, token generation
4. **Python Sniffer**: Packet capture and storage (separate service)

---

## Ollama API Integration

### What is Ollama?

Ollama is a **local LLM runtime** that:
- Runs models on the local machine (CPU/GPU)
- Provides a REST API for model interaction
- Manages model loading, context, and inference
- Supports multiple model formats (GGUF, etc.)

### API Communication Pattern

```javascript
// PSEUDOCODE: Basic Ollama API Call

FUNCTION callOllamaAPI(modelName, messages):
    // Construct request body
    requestBody = {
        model: modelName,           // e.g., "gemma3:4b"
        stream: false,              // true = streaming, false = complete response
        messages: messages          // Array of {role, content} objects
    }
    
    // Send HTTP POST request
    response = HTTP.POST(
        url: "http://127.0.0.1:11434/api/chat",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(requestBody)
    )
    
    // Parse response
    IF response.status == 200:
        data = JSON.parse(response.body)
        RETURN data.message.content  // AI-generated text
    ELSE:
        THROW ERROR("Ollama API error: " + response.status)
END FUNCTION
```

### Message Format

Ollama uses the **ChatML format** (similar to OpenAI):

```javascript
messages = [
    {
        role: "system",    // System instructions (sent once, persistent)
        content: "You are a network security analyst..."
    },
    {
        role: "user",      // User input/question
        content: "Evaluate this packet: ..."
    },
    {
        role: "assistant", // AI response (returned by Ollama)
        content: "PACKET_IDENTIFICATION: ..."
    }
]
```

### Request/Response Flow

```
┌─────────────────┐
│  Application    │
│  (server.js)    │
└────────┬────────┘
         │
         │ 1. Build messages array
         │    [system, user, assistant, ...]
         │
         │ 2. HTTP POST to Ollama
         │    POST /api/chat
         │    { model, messages }
         │
         ▼
┌─────────────────┐
│  Ollama Service │
│  (ollama serve) │
└────────┬────────┘
         │
         │ 3. Load model (if not loaded)
         │    - Load weights into VRAM/RAM
         │    - Initialize tokenizer
         │
         │ 4. Process context
         │    - Tokenize all messages
         │    - Build attention context
         │    - Apply system prompt
         │
         │ 5. Generate tokens
         │    - Forward pass through model
         │    - Sample next token
         │    - Repeat until stop condition
         │
         │ 6. Return response
         │    { message: { role: "assistant", content: "..." } }
         │
         ▼
┌─────────────────┐
│  Application    │
│  (server.js)    │
└─────────────────┘
```

### Implementation Details

```javascript
// ACTUAL CODE: evaluatePacketWithContext function

async function evaluatePacketWithContext(targetPacket, contextPackets) {
    const packetId = targetPacket.id;
    
    // STEP 1: Get or create chat session
    let messages = chatManager.getMessages(packetId);
    if (!messages) {
        chatManager.createSession(packetId, SYSTEM_PROMPT);
        messages = chatManager.getMessages(packetId);
    }
    
    // STEP 2: Build context string
    const fullContext = buildContextString(targetPacket, contextPackets);
    const userMessage = fullContext + "\n\nEvaluate ONLY the TARGET PACKET...";
    
    // STEP 3: Add user message to session
    chatManager.addMessage(packetId, "user", userMessage);
    messages = chatManager.getMessages(packetId); // Get updated messages (may be trimmed)
    
    // STEP 4: Prepare Ollama request
    const body = {
        model: "gemma3:4b",  // Model name (must be pulled via: ollama pull gemma3:4b)
        stream: false,       // Get complete response (not streaming)
        messages: messages    // Full conversation history
    };
    
    // STEP 5: Call Ollama API
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    
    // STEP 6: Parse response
    if (!resp.ok) {
        throw new Error(`Ollama error ${resp.status}`);
    }
    
    const data = await resp.json();
    const response = data?.message?.content ?? "";
    
    // STEP 7: Store AI response in session
    chatManager.addMessage(packetId, "assistant", response);
    
    return response;
}
```

---

## Model Selection and Flexibility

### Available Models

Ollama supports many models. To use a different model:

```bash
# Pull a model
ollama pull llama3:8b
ollama pull mistral:7b
ollama pull gemma2:9b

# List available models
ollama list
```

### Model Configuration

```javascript
// CURRENT: Hardcoded model name
const MODEL_NAME = "gemma3:4b";

// FLEXIBLE: Environment variable or config
const MODEL_NAME = process.env.OLLAMA_MODEL || "gemma3:4b";

// OR: Per-request model selection
const body = {
    model: req.body.model || "gemma3:4b",  // Allow client to specify
    messages: messages
};
```

### Model Characteristics

Different models have different capabilities:

| Model | Size | Context | Speed | Quality | Use Case |
|-------|------|---------|-------|---------|----------|
| gemma3:4b | 4B params | 8K tokens | Fast | Good | Quick evaluations |
| llama3:8b | 8B params | 8K tokens | Medium | Better | Balanced |
| mistral:7b | 7B params | 32K tokens | Medium | Better | Long conversations |
| llama3:70b | 70B params | 8K tokens | Slow | Best | Highest quality |

### Model Selection Strategy

```javascript
// PSEUDOCODE: Dynamic model selection

FUNCTION selectModel(packetComplexity, conversationLength):
    // Simple packet, short conversation
    IF packetComplexity == "simple" AND conversationLength < 5:
        RETURN "gemma3:4b"  // Fast, efficient
    
    // Complex packet or long conversation
    ELSE IF packetComplexity == "complex" OR conversationLength > 10:
        RETURN "mistral:7b"  // Better quality, larger context
    
    // Default
    ELSE:
        RETURN "llama3:8b"  // Balanced
END FUNCTION
```

### Model Loading and Memory

```javascript
// PSEUDOCODE: Model lifecycle in Ollama

WHEN Ollama starts:
    models = {}  // Empty model cache
    
WHEN first request arrives for model "gemma3:4b":
    IF model not in cache:
        LOAD model from disk
        PARSE model file (GGUF format)
        ALLOCATE VRAM/RAM for model weights
        LOAD weights into memory
        INITIALIZE tokenizer
        CACHE model in memory
    END IF
    
    USE cached model for inference
    
WHEN model idle for long time:
    OPTIONALLY unload from memory (free VRAM)
    KEEP model file on disk
```

### Switching Models

```javascript
// To switch models, simply change the model name:

// Option 1: Change in code
const MODEL_NAME = "llama3:8b";  // Changed from gemma3:4b

// Option 2: Environment variable
// OLLAMA_MODEL=llama3:8b npm start

// Option 3: Per-session model
chatManager.createSession(packetId, SYSTEM_PROMPT, "llama3:8b");
```

**Important**: Each model has different:
- Token limits (context window)
- Response formats
- Instruction following capabilities
- Speed/quality tradeoffs

---

## Context Window Management

### What is a Context Window?

The **context window** is the maximum number of tokens the model can process in a single request.

```
Context Window = Maximum tokens (input + output)

Example (gemma3:4b):
- Context window: 8,192 tokens
- Input: Up to ~7,500 tokens
- Output: Up to ~500 tokens (reserved)
```

### Token Estimation

```javascript
// PSEUDOCODE: Token estimation

FUNCTION estimateTokens(text):
    // Rough estimate: 1 token ≈ 4 characters
    // More accurate: Use actual tokenizer (but slower)
    
    characterCount = LENGTH(text)
    estimatedTokens = CEIL(characterCount / 4)
    
    RETURN estimatedTokens
END FUNCTION

// Example:
text = "Hello, how are you?"  // 19 characters
tokens = estimateTokens(text)  // ≈ 5 tokens
```

### Context Window Limits

```javascript
// PSEUDOCODE: Context window management

CLASS ChatSessionManager:
    maxContextTokens = 6000  // Conservative limit (8K model - 2K reserve)
    charsPerToken = 4         // Estimation factor
    
    FUNCTION getTotalTokens(messages):
        total = 0
        FOR EACH message IN messages:
            // Count role + content + JSON overhead
            total += estimateTokens(JSON.stringify(message))
        END FOR
        RETURN total
    END FUNCTION
    
    FUNCTION trimToContextWindow(messages):
        // ALWAYS keep system prompt (first message)
        systemPrompt = messages[0]
        otherMessages = messages.slice(1)
        
        // Calculate available space
        systemTokens = estimateTokens(JSON.stringify(systemPrompt))
        availableTokens = maxContextTokens - systemTokens - 500  // Reserve for response
        
        // If system prompt alone is too large, return just it
        IF systemTokens > maxContextTokens - 500:
            RETURN [systemPrompt]
        END IF
        
        // Keep most recent messages (newest to oldest)
        trimmedMessages = [systemPrompt]
        totalTokens = 0
        
        FOR i = otherMessages.length - 1 DOWN TO 0:
            message = otherMessages[i]
            messageTokens = estimateTokens(JSON.stringify(message))
            
            IF totalTokens + messageTokens <= availableTokens:
                trimmedMessages.push(message)
                totalTokens += messageTokens
            ELSE:
                BREAK  // Can't fit more
            END IF
        END FOR
        
        // Reverse to chronological order
        result = [systemPrompt] + REVERSE(trimmedMessages.slice(1))
        
        RETURN result
    END FUNCTION
END CLASS
```

### Context Window Behavior

```
┌─────────────────────────────────────────────────┐
│ Context Window: 8,192 tokens                   │
├─────────────────────────────────────────────────┤
│ System Prompt:     200 tokens  [ALWAYS KEPT]    │
│ Reserve for AI:    500 tokens  [RESERVED]       │
│ Available:       7,492 tokens  [FOR MESSAGES]   │
└─────────────────────────────────────────────────┘

Example Conversation Growth:

Message 1 (user):     500 tokens  [Total: 700]
Message 2 (AI):       800 tokens  [Total: 1,500]
Message 3 (user):     300 tokens  [Total: 1,800]
Message 4 (AI):       400 tokens  [Total: 2,200]
...
Message 20 (user):    250 tokens  [Total: 8,000]  ← Approaching limit
Message 21 (user):    300 tokens  [Total: 8,300]  ← EXCEEDS LIMIT!

TRIM OPERATION:
- Keep: System prompt (200 tokens)
- Keep: Messages 15-21 (most recent, ~2,000 tokens)
- Remove: Messages 1-14 (oldest, ~6,000 tokens)
- Result: 2,200 tokens (fits in window)
```

### Why This Matters

1. **System Prompt Protection**: System prompt is never removed, ensuring AI maintains behavior
2. **Recent Context**: Most recent conversation is preserved
3. **Automatic Management**: No manual intervention needed
4. **Model Agnostic**: Works with any context window size

---

## System Prompts and Instructions

### What is a System Prompt?

A **system prompt** is instructions given to the AI that define:
- Its role and behavior
- Response format requirements
- Constraints and restrictions
- Task-specific guidance

### System Prompt Lifecycle

```javascript
// PSEUDOCODE: System prompt in session

SESSION CREATION:
    messages = [
        { role: "system", content: SYSTEM_PROMPT }  // Set once
    ]

FIRST EVALUATION:
    messages = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Evaluate packet..." },
        { role: "assistant", content: "PACKET_IDENTIFICATION: ..." }
    ]

SWITCH TO CHAT MODE (first follow-up):
    messages[0] = { role: "system", content: CHAT_SYSTEM_PROMPT }  // Replace
    
FOLLOW-UP QUESTIONS:
    messages = [
        { role: "system", content: CHAT_SYSTEM_PROMPT },  // Persistent
        { role: "user", content: "Evaluate packet..." },
        { role: "assistant", content: "PACKET_IDENTIFICATION: ..." },
        { role: "user", content: "Why is this dangerous?" },
        { role: "assistant", content: "This packet is dangerous because..." }
    ]
```

### Current System Prompts

#### 1. Evaluation Prompt (Initial)

```javascript
const SYSTEM_PROMPT = `
You are a network security analyst. Evaluate ONLY the TARGET PACKET marked in the input.

REQUIRED RESPONSE FORMAT:
PACKET_IDENTIFICATION: [details]
SEVERITY: [number 0-100]
CONFIDENCE: [number 0-100]
RATIONALE: [explanation]

CRITICAL REQUIREMENTS:
- SEVERITY and CONFIDENCE MUST be numeric (0-100)
- NO MARKDOWN formatting
- Plain text only
`;
```

**Purpose**: 
- Sets role (network security analyst)
- Defines strict output format
- Ensures structured, parseable responses

#### 2. Chat Prompt (Follow-ups)

```javascript
const CHAT_SYSTEM_PROMPT = `
You are a network security analyst helping a user understand a packet evaluation.

CRITICAL RESTRICTION: 
You MUST ONLY respond to questions about cybersecurity, network security, 
packet analysis, threat assessment, and related security topics.

If the user asks about anything unrelated to cybersecurity, politely decline 
and redirect them to ask about the packet's security implications instead.

Answer questions clearly and concisely, referencing packet details when relevant.
`;
```

**Purpose**:
- Maintains security focus
- Enforces topic restrictions
- Enables conversational follow-ups

### How System Prompts Work

```javascript
// PSEUDOCODE: System prompt processing in model

WHEN model receives messages:
    systemPrompt = FIND message WHERE role == "system"
    userMessages = FIND messages WHERE role == "user"
    assistantMessages = FIND messages WHERE role == "assistant"
    
    // Model internally processes:
    context = BUILD_CONTEXT(
        instructions: systemPrompt.content,
        conversation: [userMessages, assistantMessages]
    )
    
    // System prompt influences:
    - Response style
    - Output format
    - Topic restrictions
    - Behavior constraints
    
    GENERATE response USING context
END WHEN
```

### Prompt Persistence

**Key Insight**: System prompt is sent **once** when session is created, then maintained in message history.

```javascript
// NOT THIS (inefficient):
FOR EACH request:
    send [system, user, assistant, user, assistant, ...]  // System sent every time

// BUT THIS (efficient):
SESSION CREATION:
    messages = [system]  // System prompt stored

EACH REQUEST:
    send messages  // System prompt already in array, sent as part of context
```

**Why This Works**:
- System prompt is in message history
- Every request includes full history
- Model sees system prompt in context
- Instructions persist throughout conversation

---

## Chat Session Management

### Session Structure

```javascript
// PSEUDOCODE: Session data structure

SESSION = {
    packetId: "packet-123",           // Unique identifier
    messages: [                       // Conversation history
        { role: "system", content: "..." },
        { role: "user", content: "..." },
        { role: "assistant", content: "..." }
    ],
    createdAt: 1234567890,           // Timestamp
    lastAccess: 1234567890,          // Last activity
    systemPromptType: "evaluation"   // or "chat"
}
```

### Session Lifecycle

```javascript
// PSEUDOCODE: Complete session lifecycle

FUNCTION evaluatePacket(packetId):
    // STEP 1: Check if session exists
    session = chatManager.getSession(packetId)
    
    IF session == null:
        // STEP 2: Create new session
        session = chatManager.createSession(
            packetId: packetId,
            systemPrompt: SYSTEM_PROMPT
        )
        // session.messages = [{ role: "system", content: SYSTEM_PROMPT }]
    END IF
    
    // STEP 3: Build evaluation request
    contextString = buildPacketContext(packetId)
    userMessage = contextString + "\n\nEvaluate ONLY the TARGET PACKET..."
    
    // STEP 4: Add user message
    chatManager.addMessage(packetId, "user", userMessage)
    // session.messages now: [system, user]
    
    // STEP 5: Get messages (may be trimmed if too long)
    messages = chatManager.getMessages(packetId)
    
    // STEP 6: Call Ollama
    response = callOllamaAPI("gemma3:4b", messages)
    
    // STEP 7: Store AI response
    chatManager.addMessage(packetId, "assistant", response)
    // session.messages now: [system, user, assistant]
    
    RETURN response
END FUNCTION

FUNCTION askFollowUpQuestion(packetId, question):
    // STEP 1: Get session
    session = chatManager.getSession(packetId)
    IF session == null:
        ERROR "Session not found"
    END IF
    
    // STEP 2: Switch to chat mode if first follow-up
    IF session.messages.length == 3:  // system + user + assistant (evaluation)
        session.messages[0] = { role: "system", content: CHAT_SYSTEM_PROMPT }
    END IF
    
    // STEP 3: Add question
    chatManager.addMessage(packetId, "user", question)
    
    // STEP 4: Get messages (trimmed if needed)
    messages = chatManager.getMessages(packetId)
    
    // STEP 5: Call Ollama
    response = callOllamaAPI("gemma3:4b", messages)
    
    // STEP 6: Store response
    chatManager.addMessage(packetId, "assistant", response)
    
    RETURN response
END FUNCTION
```

### Session Storage

```javascript
// PSEUDOCODE: Session storage implementation

CLASS ChatSessionManager:
    sessions = Map<packetId, Session>()  // In-memory storage
    ttl = 3600000  // 1 hour in milliseconds
    
    FUNCTION createSession(packetId, systemPrompt):
        session = {
            messages: [{ role: "system", content: systemPrompt }],
            createdAt: NOW(),
            lastAccess: NOW(),
            packetId: packetId
        }
        
        sessions.set(packetId, session)
        RETURN session
    END FUNCTION
    
    FUNCTION getSession(packetId):
        session = sessions.get(packetId)
        
        IF session == null:
            RETURN null
        END IF
        
        // Check expiration
        IF NOW() - session.lastAccess > ttl:
            sessions.delete(packetId)  // Expired
            RETURN null
        END IF
        
        RETURN session
    END FUNCTION
    
    FUNCTION addMessage(packetId, role, content):
        session = getSession(packetId)
        IF session == null:
            ERROR "Session not found"
        END IF
        
        session.messages.push({ role: role, content: content })
        session.lastAccess = NOW()
        
        RETURN session
    END FUNCTION
    
    FUNCTION cleanupOldSessions():
        FOR EACH (packetId, session) IN sessions:
            IF NOW() - session.lastAccess > ttl:
                sessions.delete(packetId)
            END IF
        END FOR
    END FUNCTION
END CLASS
```

### Memory Management

```javascript
// PSEUDOCODE: Memory usage calculation

FUNCTION getStats():
    totalMessages = 0
    totalChars = 0
    
    FOR EACH session IN sessions.values():
        totalMessages += session.messages.length
        FOR EACH message IN session.messages:
            totalChars += LENGTH(JSON.stringify(message))
        END FOR
    END FOR
    
    // Estimate: 1 char ≈ 1 byte
    estimatedBytes = totalChars + (sessions.size * 200)  // Overhead
    
    RETURN {
        activeSessions: sessions.size,
        totalMessages: totalMessages,
        estimatedMemoryMB: estimatedBytes / 1024 / 1024
    }
END FUNCTION
```

---

## Application Layers

### Layer 1: Frontend (User Interface)

**File**: `public/packet-analyzer.html`, `public/packet-analyzer.js`

**Responsibilities**:
- Display packets
- User interaction (clicking, evaluating)
- Chat interface
- Memory stats display

**Interfaces**:
```javascript
// PSEUDOCODE: Frontend API calls

FUNCTION evaluatePacket(packetId):
    response = HTTP.POST("/api/evaluate", {
        packetId: packetId,
        before: 5,
        after: 5
    })
    
    IF response.ok:
        UPDATE_UI(response.evaluation)
    END IF
END FUNCTION

FUNCTION askQuestion(packetId, question):
    response = HTTP.POST("/api/chat/ask", {
        packetId: packetId,
        question: question
    })
    
    IF response.ok:
        DISPLAY_MESSAGE(response.answer)
    END IF
END FUNCTION

FUNCTION updateMemoryStats():
    stats = HTTP.GET("/api/memory")
    DISPLAY(stats.chatSessions)
    DISPLAY(stats.processMemory)
    DISPLAY(stats.ollamaMemory)
END FUNCTION
```

### Layer 2: Backend API (Application Server)

**File**: `server.js`

**Responsibilities**:
- HTTP API endpoints
- Session management
- Context window management
- Ollama API proxying

**Endpoints**:
```javascript
// PSEUDOCODE: API endpoints

POST /api/evaluate
    INPUT: { packetId, before, after }
    PROCESS:
        1. Fetch packet context from Python sniffer
        2. Get or create chat session
        3. Build evaluation request
        4. Call Ollama API
        5. Store response in session
    OUTPUT: { ok, packetId, evaluation, packet }

POST /api/chat/ask
    INPUT: { packetId, question }
    PROCESS:
        1. Get chat session
        2. Switch to chat mode if needed
        3. Add user question
        4. Call Ollama API
        5. Store response
    OUTPUT: { ok, packetId, answer }

GET /api/chat/:packetId
    INPUT: packetId (URL parameter)
    PROCESS:
        1. Get chat session
        2. Return message history (without system prompt)
    OUTPUT: { ok, packetId, messages }

GET /api/memory
    INPUT: none
    PROCESS:
        1. Get chat session stats
        2. Get Node.js process memory
        3. Get Ollama memory (if available)
        4. Get system memory (if available)
    OUTPUT: { ok, chatSessions, processMemory, ollamaMemory, systemMemory }
```

### Layer 3: Chat Session Manager

**File**: `server.js` (ChatSessionManager class)

**Responsibilities**:
- Session creation/deletion
- Message history management
- Context window trimming
- Memory tracking

**Key Methods**:
```javascript
// PSEUDOCODE: ChatSessionManager methods

CLASS ChatSessionManager:
    FUNCTION createSession(packetId, systemPrompt):
        // Create new session with system prompt
    END FUNCTION
    
    FUNCTION getSession(packetId):
        // Get session, check expiration
    END FUNCTION
    
    FUNCTION addMessage(packetId, role, content):
        // Add message to session
    END FUNCTION
    
    FUNCTION getMessages(packetId):
        // Get messages, trim if needed
    END FUNCTION
    
    FUNCTION trimToContextWindow(messages):
        // Trim messages while preserving system prompt
    END FUNCTION
    
    FUNCTION getStats():
        // Calculate memory usage
    END FUNCTION
END CLASS
```

### Layer 4: Ollama Service

**External Service**: `ollama serve`

**Responsibilities**:
- Model loading and management
- Token generation
- Context processing
- API endpoint: `/api/chat`

**Communication**:
```javascript
// PSEUDOCODE: Ollama service interaction

FUNCTION callOllama(model, messages):
    request = {
        model: model,
        stream: false,
        messages: messages
    }
    
    response = HTTP.POST("http://127.0.0.1:11434/api/chat", request)
    
    RETURN response.message.content
END FUNCTION
```

### Layer 5: Python Packet Sniffer

**External Service**: `packet_sniffer.py`

**Responsibilities**:
- Network packet capture
- Packet storage
- Context retrieval

**Interfaces**:
```python
# PSEUDOCODE: Python sniffer endpoints

GET /api/packets?limit=100
    RETURN: { packets: [...] }

GET /api/packets/:packetId/context?before=5&after=5
    RETURN: { packets: [before..., target, after...] }
```

---

## Prompt Engineering

### What is Prompt Engineering?

**Prompt engineering** is the practice of designing and optimizing prompts to:
- Get desired outputs from AI models
- Control model behavior
- Improve response quality
- Reduce errors and hallucinations

### Current Prompt Engineering Strategy

#### 1. Role Definition

```javascript
"You are a network security analyst."
```

**Why**: Sets the AI's identity and expertise domain.

#### 2. Task Specification

```javascript
"Evaluate ONLY the TARGET PACKET marked in the input."
```

**Why**: Clearly defines what to do, prevents confusion.

#### 3. Format Requirements

```javascript
"REQUIRED RESPONSE FORMAT:
PACKET_IDENTIFICATION: [details]
SEVERITY: [number 0-100]
CONFIDENCE: [number 0-100]"
```

**Why**: Ensures parseable, structured output.

#### 4. Constraints

```javascript
"CRITICAL REQUIREMENTS:
- SEVERITY and CONFIDENCE MUST be numeric (0-100)
- NO MARKDOWN formatting
- Plain text only"
```

**Why**: Prevents format errors, ensures consistency.

#### 5. Topic Restrictions

```javascript
"CRITICAL RESTRICTION: 
You MUST ONLY respond to questions about cybersecurity..."
```

**Why**: Prevents off-topic responses, maintains focus.

### Prompt Engineering Techniques Used

#### Technique 1: Explicit Instructions

```javascript
// GOOD: Explicit
"SEVERITY: [number 0-100]"

// BAD: Vague
"Rate the severity"
```

#### Technique 2: Examples (Few-Shot)

```javascript
// Could add examples:
"Example response:
PACKET_IDENTIFICATION: Packet ID: 123, Protocol: TCP...
SEVERITY: 75
CONFIDENCE: 85"
```

#### Technique 3: Negative Instructions

```javascript
"ABSOLUTELY NO MARKDOWN - NO ASTERISKS (*) ANYWHERE"
```

#### Technique 4: Emphasis

```javascript
"CRITICAL REQUIREMENTS:"  // Emphasizes importance
"MUST include"           // Strong requirement
```

### Prompt Engineering as Foundation for Fine-Tuning

**Why prompt engineering matters for fine-tuning**:

1. **Defines Target Behavior**: Good prompts define desired output format
2. **Creates Training Data**: Prompt + good responses = training examples
3. **Identifies Gaps**: Where prompts fail, fine-tuning can help
4. **Establishes Patterns**: Consistent prompt structure = consistent training

**Example**:
```
Prompt Engineering Phase:
- Try different prompt formats
- Test with various packets
- Identify what works/doesn't work
- Refine instructions

Fine-Tuning Phase:
- Use successful prompts as training data
- Train model to follow format automatically
- Reduce need for explicit instructions
- Improve consistency
```

---

## Future: Fine-Tuning and Training

### What is Fine-Tuning?

**Fine-tuning** is training a pre-trained model on custom data to:
- Adapt to specific tasks
- Learn domain-specific knowledge
- Improve performance on specific use cases
- Reduce prompt engineering needs

### Fine-Tuning Process

```javascript
// PSEUDOCODE: Fine-tuning workflow

STEP 1: Data Collection
    trainingData = []
    
    FOR EACH packet evaluation:
        input = buildPacketContext(packet)
        output = getAIResponse(input)  // Current AI response
        
        IF output is good quality:
            trainingData.push({
                input: input,
                output: output,
                systemPrompt: SYSTEM_PROMPT
            })
        END IF
    END FOR
    
    SAVE trainingData TO "training_dataset.jsonl"

STEP 2: Data Formatting
    FOR EACH example IN trainingData:
        formatted = {
            messages: [
                { role: "system", content: example.systemPrompt },
                { role: "user", content: example.input },
                { role: "assistant", content: example.output }
            ]
        }
        WRITE formatted TO "formatted_dataset.jsonl"
    END FOR

STEP 3: Model Training
    RUN fine_tuning_script(
        base_model: "gemma3:4b",
        training_data: "formatted_dataset.jsonl",
        epochs: 3,
        learning_rate: 0.0001
    )
    
    OUTPUT: "gemma3:4b-packet-analyzer"  // Fine-tuned model

STEP 4: Model Deployment
    ollama create gemma3:4b-packet-analyzer -f Modelfile
    # Modelfile contains fine-tuned weights
    
    UPDATE server.js:
        MODEL_NAME = "gemma3:4b-packet-analyzer"
END PROCESS
```

### Training Data Structure

```json
// Example training data format

{
    "messages": [
        {
            "role": "system",
            "content": "You are a network security analyst..."
        },
        {
            "role": "user",
            "content": "=== TARGET PACKET ===\nPacket ID: 123..."
        },
        {
            "role": "assistant",
            "content": "PACKET_IDENTIFICATION: Packet ID: 123...\nSEVERITY: 75\nCONFIDENCE: 85..."
        }
    ]
}
```

### Fine-Tuning Benefits

**Before Fine-Tuning**:
- Requires detailed system prompts
- May need format corrections
- Inconsistent responses
- High token usage (long prompts)

**After Fine-Tuning**:
- Shorter prompts needed
- Consistent format automatically
- Better domain knowledge
- Faster responses

### Implementation Path

```javascript
// PSEUDOCODE: Fine-tuning integration

FUNCTION collectTrainingData():
    // Collect good evaluations
    trainingData = []
    
    FOR EACH session IN chatManager.sessions:
        IF session.messages.length >= 3:  // Has evaluation
            evaluation = session.messages[2]  // AI response
            
            IF isValidEvaluation(evaluation):
                trainingData.push({
                    system: session.messages[0].content,
                    user: session.messages[1].content,
                    assistant: evaluation.content
                })
            END IF
        END IF
    END FOR
    
    EXPORT trainingData TO "training_data.jsonl"
END FUNCTION

FUNCTION useFineTunedModel():
    // After fine-tuning, use new model
    MODEL_NAME = "gemma3:4b-packet-analyzer"
    
    // Can use shorter prompts
    SIMPLIFIED_SYSTEM_PROMPT = "Evaluate network packets for security threats."
    
    // Model already knows format from training
END FUNCTION
```

### Fine-Tuning Tools

**Ollama Fine-Tuning** (Future):
```bash
# Hypothetical future Ollama fine-tuning
ollama fine-tune \
    --base gemma3:4b \
    --data training_data.jsonl \
    --output gemma3:4b-packet-analyzer
```

**Alternative Tools**:
- **LoRA** (Low-Rank Adaptation): Efficient fine-tuning
- **QLoRA**: Quantized LoRA (memory efficient)
- **PEFT**: Parameter-Efficient Fine-Tuning

---

## Data Flow and Interfaces

### Complete Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    USER INTERACTION                         │
│  User clicks "Evaluate" on packet #123                     │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND (packet-analyzer.js)                  │
│  evaluatePacket("packet-123")                              │
│  → HTTP POST /api/evaluate                                 │
│    { packetId: "packet-123", before: 5, after: 5 }         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKEND API (server.js)                        │
│  POST /api/evaluate handler                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ 1. Fetch packet context from Python sniffer           │ │
│  │    GET http://localhost:5000/api/packets/123/context │ │
│  └───────────────────────┬──────────────────────────────┘ │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │ 2. Get or create chat session                         │ │
│  │    chatManager.getSession("packet-123")              │ │
│  │    IF null: createSession("packet-123", SYSTEM_PROMPT)│
│  └───────────────────────┬──────────────────────────────┘ │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │ 3. Build context string                               │ │
│  │    buildContextString(targetPacket, contextPackets)  │ │
│  └───────────────────────┬──────────────────────────────┘ │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │ 4. Add user message to session                        │ │
│  │    chatManager.addMessage("packet-123", "user", ...)  │ │
│  └───────────────────────┬──────────────────────────────┘ │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │ 5. Get messages (may trim if too long)               │ │
│  │    messages = chatManager.getMessages("packet-123")   │ │
│  │    IF tokens > limit: trimToContextWindow(messages)   │ │
│  └───────────────────────┬──────────────────────────────┘ │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐ │
│  │ 6. Call Ollama API                                    │ │
│  │    POST http://127.0.0.1:11434/api/chat               │ │
│  │    { model: "gemma3:4b", messages: [...] }            │ │
│  └───────────────────────┬──────────────────────────────┘ │
└──────────────────────────┼─────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              OLLAMA SERVICE                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Receive request                                    │  │
│  │    Parse: { model, messages }                         │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │ 2. Load model (if not loaded)                          │  │
│  │    IF model not in memory:                             │  │
│  │      LOAD "gemma3:4b" from disk                        │  │
│  │      ALLOCATE VRAM/RAM                                 │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │ 3. Process context                                     │  │
│  │    Tokenize all messages                               │  │
│  │    Build attention context                             │  │
│  │    Apply system prompt instructions                    │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │ 4. Generate response                                   │  │
│  │    FOR EACH token:                                     │  │
│  │      Forward pass through model                        │  │
│  │      Sample next token                                 │  │
│  │      UNTIL stop condition (</s> or max tokens)        │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │ 5. Return response                                     │  │
│  │    { message: { role: "assistant", content: "..." } }   │  │
│  └───────────────────────┬──────────────────────────────┘  │
└──────────────────────────┼─────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKEND API (server.js)                        │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 7. Store AI response in session                       │  │
│  │    chatManager.addMessage("packet-123", "assistant", response)│
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                 │
│  ┌───────────────────────▼──────────────────────────────┐  │
│  │ 8. Return to frontend                                 │  │
│  │    { ok: true, packetId: "packet-123", evaluation: "..." }│
│  └───────────────────────┬──────────────────────────────┘  │
└──────────────────────────┼─────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND (packet-analyzer.js)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 9. Update UI                                          │  │
│  │    Display evaluation in packet details              │  │
│  │    Update sidebar with packet info                   │  │
│  │    Show chat interface                               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Interface Contracts

#### Frontend → Backend

```javascript
// Evaluation Request
POST /api/evaluate
Request: {
    packetId: string,
    before?: number,  // Default: 5
    after?: number    // Default: 5
}
Response: {
    ok: boolean,
    packetId: string,
    evaluation: string,
    packet: PacketObject
}

// Chat Question
POST /api/chat/ask
Request: {
    packetId: string,
    question: string
}
Response: {
    ok: boolean,
    packetId: string,
    answer: string
}

// Chat History
GET /api/chat/:packetId
Response: {
    ok: boolean,
    packetId: string,
    messages: Array<{role: string, content: string}>
}

// Memory Stats
GET /api/memory
Response: {
    ok: boolean,
    chatSessions: {
        activeSessions: number,
        totalMessages: number,
        estimatedMemoryMB: string
    },
    processMemory: {
        rss: string,
        heapUsed: string
    },
    ollamaMemory: {
        total_vram_mb: string,
        models: Array<{name: string, size_vram_mb: string}>
    },
    systemMemory: {
        total_gb: string,
        used_gb: string,
        usage_percent: string
    }
}
```

#### Backend → Ollama

```javascript
POST http://127.0.0.1:11434/api/chat
Request: {
    model: string,      // e.g., "gemma3:4b"
    stream: boolean,    // false for complete response
    messages: Array<{
        role: "system" | "user" | "assistant",
        content: string
    }>
}
Response: {
    model: string,
    created_at: string,
    message: {
        role: "assistant",
        content: string
    },
    done: boolean
}
```

#### Backend → Python Sniffer

```javascript
GET http://localhost:5000/api/packets/:packetId/context?before=5&after=5
Response: {
    packets: Array<PacketObject>
}

GET http://localhost:5000/api/packets?limit=100
Response: {
    packets: Array<PacketObject>
}
```

---

## Summary

### Key Concepts

1. **Ollama API**: RESTful interface to local LLM models
2. **Context Window**: Maximum tokens model can process (managed automatically)
3. **System Prompts**: Instructions that persist in session (sent once, maintained)
4. **Chat Sessions**: Per-packet conversation history (stored in memory)
5. **Prompt Engineering**: Designing prompts for desired behavior (foundation for fine-tuning)
6. **Fine-Tuning**: Training models on custom data (future capability)

### Architecture Benefits

- **Modular**: Each layer has clear responsibilities
- **Flexible**: Easy to swap models, change prompts
- **Scalable**: Session management handles many conversations
- **Maintainable**: Clear separation of concerns

### Future Enhancements

1. **Fine-Tuning**: Train custom model on packet evaluation data
2. **Multi-Model**: Use different models for different tasks
3. **Streaming**: Real-time token generation for better UX
4. **Caching**: Cache common evaluations
5. **Analytics**: Track prompt effectiveness, model performance

This architecture provides a solid foundation for AI-powered packet analysis with room for growth and improvement.


