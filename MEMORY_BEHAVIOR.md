# Memory Behavior with Multiple Evaluations

## What Happens with 100+ Evaluations?

### Current Implementation

Your system now uses **persistent chat sessions** - one chat per packet ID. Here's what happens as you evaluate more packets:

### Memory Management

1. **Chat Session Limit**: Maximum of **100 active chat sessions** (configurable via `MAX_CHAT_SESSIONS`)

2. **LRU (Least Recently Used) Cleanup**: 
   - When you hit 100 sessions, the oldest (least recently accessed) session is automatically removed
   - This prevents unlimited memory growth
   - New evaluations can still proceed

3. **TTL (Time To Live)**: 
   - Sessions expire after **1 hour** of inactivity
   - Expired sessions are cleaned up automatically every 5 minutes
   - This frees memory from old, unused chats

### Memory Usage Per Session

Each chat session stores:
- System prompt: ~500 bytes
- Initial evaluation (user message + AI response): ~2-5 KB
- Each follow-up Q&A: ~1-3 KB per exchange

**Estimated memory per session:**
- First evaluation only: ~3-6 KB
- With 5 follow-up questions: ~8-20 KB
- With 10 follow-up questions: ~13-35 KB

**100 sessions estimate:**
- Minimum (no follow-ups): ~300-600 KB
- Average (some follow-ups): ~1-2 MB
- Maximum (many follow-ups): ~3-5 MB

### What Happens When You Overload?

#### Scenario 1: 100 Evaluations (At the Limit)

**Behavior:**
- ✅ All 100 sessions are active in memory
- ✅ Memory usage: ~1-5 MB (very manageable)
- ✅ Performance: **No noticeable impact**
- ✅ New evaluations: Oldest session is removed (LRU)

**Result:** System continues working normally. You might lose the chat history of the oldest evaluated packet, but new evaluations work fine.

#### Scenario 2: 200 Evaluations (Over the Limit)

**Behavior:**
- ✅ Only 100 most recent sessions kept in memory
- ✅ Oldest 100 sessions are removed (LRU)
- ✅ Memory usage stays at ~1-5 MB
- ✅ Performance: **No noticeable impact**

**Result:** You can evaluate as many packets as you want. The system automatically manages memory by keeping only the 100 most recently accessed sessions.

#### Scenario 3: Memory Overload (Hypothetical - Won't Happen with Current Limits)

If somehow you had thousands of sessions (which the current system prevents):

**Symptoms:**
1. **Gradual Performance Degradation**
   - Slower response times
   - Higher CPU usage
   - Browser may become sluggish

2. **Node.js Process Memory**
   - Heap memory grows
   - Garbage collection runs more frequently
   - Eventually: Out of Memory (OOM) error

3. **System Behavior**
   - Server may crash or become unresponsive
   - Browser tab may freeze
   - Need to restart the server

**But this won't happen** because:
- ✅ Maximum 100 sessions enforced
- ✅ Automatic cleanup prevents unlimited growth
- ✅ TTL ensures old sessions expire

### Memory Monitoring

The navbar shows real-time memory stats:

- **Sessions**: Current active sessions / Maximum (e.g., "45/100")
- **Memory**: Estimated memory used by chat sessions (KB/MB)
- **Heap**: Node.js process heap memory (MB)

**Color Coding:**
- **Green**: Normal usage (< 60% of limit)
- **Orange**: Warning (60-80% of limit)
- **Red**: Critical (> 80% of limit)

### Best Practices

1. **Monitor the Memory Stats**: Keep an eye on the navbar stats
2. **Don't Worry About 100 Evaluations**: The system handles it automatically
3. **Old Sessions Auto-Expire**: Inactive chats are cleaned up after 1 hour
4. **LRU Protects You**: Most recently used sessions are preserved

### Configuration

You can adjust limits in `server.js`:

```javascript
const MAX_CHAT_SESSIONS = 100;  // Increase if you have more RAM
const CHAT_SESSION_TTL = 3600000; // 1 hour - decrease for faster cleanup
```

### Summary

**With 100+ evaluations:**
- ✅ **Performance**: No noticeable impact (memory is well-managed)
- ✅ **Functionality**: Everything continues working
- ✅ **Memory**: Stays under control (1-5 MB typically)
- ✅ **Automatic Cleanup**: Old sessions removed automatically

**The system is designed to handle many evaluations gracefully!**


