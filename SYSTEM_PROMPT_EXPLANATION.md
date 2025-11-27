# System Prompt and Chat Session Behavior

## How System Prompts Work

### Initial Evaluation (First Message)

When you evaluate a packet for the first time:

1. **New chat session is created** for that packet ID
2. **System prompt is sent ONCE** - the evaluation system prompt (`SYSTEM_PROMPT`)
3. This prompt instructs the AI on:
   - How to format the evaluation response
   - What fields are required (SEVERITY, CONFIDENCE, etc.)
   - That it should only evaluate the target packet

**This system prompt is stored in the chat session** and persists for all future messages in that session.

### Follow-up Questions (Chat Mode)

When you ask a follow-up question:

1. **System prompt is switched** to chat mode (`CHAT_SYSTEM_PROMPT`)
   - This happens automatically on the first follow-up question
   - The original evaluation prompt is replaced with the chat prompt
2. **Chat prompt is persistent** - it stays in the session for all future questions
3. The chat prompt includes:
   - Instructions to only answer cybersecurity questions
   - Restriction to decline non-security topics
   - Guidance on what types of questions to answer

### Why This Works

**The system prompt is part of the chat history** - it's the first message in every session:

```
Session Messages:
1. [system] - System prompt (evaluation or chat mode)
2. [user] - Initial evaluation request
3. [assistant] - AI evaluation response
4. [user] - Follow-up question
5. [assistant] - AI answer
...
```

**Key Point:** The system prompt is NOT sent with every request. It's sent once when the session is created, then maintained in the session's message history. When you send a follow-up question, the entire message history (including the system prompt) is sent to Ollama, so the AI maintains context and behavior.

### Current Behavior

✅ **System prompt sent once** - when session is created or switched to chat mode  
✅ **Persistent instructions** - system prompt stays in session history  
✅ **AI remembers behavior** - because system prompt is in every request's context  
✅ **Cybersecurity-only restriction** - enforced via chat system prompt  

### What This Means

- The AI will remember it should only answer cybersecurity questions
- The restriction is persistent because the system prompt is in the session
- You don't need to send instructions every time - they're already in the context
- The AI maintains its role and restrictions throughout the conversation

## Memory Explanation

### What is "Context Memory"?

The "Context Memory" shown in the navbar represents:

**Chat Session History** - All conversation messages stored in RAM:
- System prompts (instructions to the AI)
- User questions
- AI responses
- Evaluation results

This is the **conversation context** that gets sent to the AI model with each request. The AI uses this context to:
- Remember previous questions and answers
- Maintain consistent behavior (from system prompt)
- Provide coherent, contextual responses

### Memory Breakdown

1. **Sessions**: Number of active chat sessions (one per evaluated packet)
2. **Context**: Total memory used by all chat session histories (KB/MB)
3. **Heap**: Node.js process memory (your server's RAM usage)
4. **Model VRAM**: GPU memory used by the AI model (if using GPU)
5. **RAM**: System-wide RAM usage (total system memory)

### Why Context Memory Matters

- **More sessions = more memory** - each session stores conversation history
- **Longer conversations = more memory** - each Q&A adds to the session
- **No limit on sessions** - only time-based expiration (1 hour inactivity)
- **Automatic cleanup** - old sessions expire and free memory

The context memory is what allows the AI to have a conversation with you about each packet - it's the "memory" of what you've discussed.


