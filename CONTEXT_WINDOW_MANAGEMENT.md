# Context Window Management

## The Problem

If a conversation exceeds the model's context window, older messages (including the system prompt) may be truncated or lost.

**Context Window Limits:**
- Most models have a fixed context window (e.g., 4K, 8K, 32K tokens)
- `gemma3:4b` typically has an 8K token context window
- When the limit is exceeded, the model may:
  - Truncate older messages
  - Lose the system prompt
  - Forget earlier instructions

## The Solution

The system implements **automatic context window management** that:

### 1. Always Preserves System Prompt

The system prompt is **always kept** - it's never removed, even when trimming messages.

### 2. Smart Message Trimming

When the context window is approached:

1. **System prompt stays** (first message, never removed)
2. **Recent messages prioritized** (newest Q&A kept)
3. **Older messages removed** (if needed to fit)
4. **Reserve space** (500 tokens reserved for AI response)

### 3. How It Works

```javascript
// Example: Context window is 6000 tokens
// System prompt: 200 tokens
// Available: 6000 - 200 - 500 (reserve) = 5300 tokens

Messages:
1. [system] - 200 tokens (ALWAYS KEPT)
2. [user] - 500 tokens (evaluation request)
3. [assistant] - 800 tokens (evaluation response)
4. [user] - 300 tokens (question 1)
5. [assistant] - 400 tokens (answer 1)
6. [user] - 250 tokens (question 2)
7. [assistant] - 350 tokens (answer 2)
... (many more messages)

Total: 8000 tokens (exceeds limit)

After trimming:
1. [system] - 200 tokens (KEPT)
2. [user] - 250 tokens (question 2) (KEPT - recent)
3. [assistant] - 350 tokens (answer 2) (KEPT - recent)
4. [user] - 300 tokens (question 1) (KEPT - recent)
5. [assistant] - 400 tokens (answer 1) (KEPT - recent)
... (older messages removed)

Total: ~5300 tokens (fits!)
```

### 4. Token Estimation

The system estimates tokens using:
- **4 characters ≈ 1 token** (rough estimate)
- Counts all message content (role + content)
- Conservative limit: 6000 tokens (safe for 8K context models)

### 5. Automatic Behavior

- **No manual intervention needed** - happens automatically
- **Transparent** - logs when trimming occurs
- **Preserves conversation flow** - keeps most recent exchanges
- **System prompt always present** - instructions never lost

## What This Means

✅ **System prompt is protected** - never removed, always in context  
✅ **Recent conversations preserved** - latest Q&A kept  
✅ **Older messages may be lost** - but system behavior maintained  
✅ **Automatic management** - no manual intervention needed  

## Limitations

⚠️ **Very long conversations** - older messages will be removed  
⚠️ **Token estimation** - uses rough estimate (4 chars = 1 token)  
⚠️ **Model-specific** - different models have different context windows  

## Configuration

The context limit can be adjusted in `server.js`:

```javascript
this.maxContextTokens = 6000; // Adjust based on your model
this.charsPerToken = 4; // Adjust if needed for your model
```

For models with larger context windows (e.g., 32K), increase `maxContextTokens` accordingly.

## Summary

Context window limits can cause the system prompt to be lost. The implementation ensures:

1. System prompt is **always preserved** (never removed)
2. Messages are **automatically trimmed** when approaching limits
3. **Recent conversations** are prioritized over old ones
4. The model **maintains its behavior** because the system prompt stays in context

The system prompt is **protected and always included** in every request.


