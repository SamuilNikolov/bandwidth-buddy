// Packet Analyzer Frontend
class PacketAnalyzer {
    constructor() {
        this.packets = new Map();
        this.lastEvaluatedPacket = null;
        this.evaluatedPackets = []; // List of all evaluated packets
        this.isMonitoring = false;
        this.updateInterval = null;
        this.packetFetchInterval = null;
        this.memoryUpdateInterval = null;
        this.packetLimit = null; // null means "all"
        this.protocolFilterValue = 'all'; // Filter by protocol type
        this.currentChatPacketId = null; // ID of packet currently being chatted about
        
        this.initializeElements();
        this.attachEventListeners();
        this.attachPacketEventListeners(); // Attach once using event delegation
        this.attachChatEventListeners();
        this.startMemoryMonitoring();
        this.checkMonitoringStatus();
    }

    initializeElements() {
        this.statusIndicator = document.getElementById('statusIndicator');
        this.statusText = document.getElementById('statusText');
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.packetList = document.getElementById('packetList');
        this.packetCount = document.getElementById('packetCount');
        this.lastUpdate = document.getElementById('lastUpdate');
        this.sidebarContent = document.getElementById('sidebarContent');
        this.packetFilter = document.getElementById('packetFilter');
        this.protocolFilter = document.getElementById('protocolFilter');
        this.contextBefore = document.getElementById('contextBefore');
        this.contextAfter = document.getElementById('contextAfter');
        this.evaluatedPacketsContainer = document.getElementById('evaluatedPacketsContainer');
        this.evaluatedCount = document.getElementById('evaluatedCount');
        this.lastEvaluatedContent = document.getElementById('lastEvaluatedContent');
        this.memorySessions = document.getElementById('memorySessions');
        this.memoryUsage = document.getElementById('memoryUsage');
        this.memoryHeap = document.getElementById('memoryHeap');
        this.memoryVRAM = document.getElementById('memoryVRAM');
        this.memoryRAM = document.getElementById('memoryRAM');
        this.chatContainer = document.getElementById('chatContainer');
        this.chatPlaceholder = document.getElementById('chatPlaceholder');
        this.chatMessages = document.getElementById('chatMessages');
        this.chatInput = document.getElementById('chatInput');
        this.chatSendBtn = document.getElementById('chatSendBtn');
    }

    attachEventListeners() {
        this.startBtn.addEventListener('click', () => this.startMonitoring());
        this.stopBtn.addEventListener('click', () => this.stopMonitoring());
        
        // Packet filter dropdown
        if (this.packetFilter) {
            this.packetFilter.addEventListener('change', (e) => {
                const value = e.target.value;
                this.packetLimit = value === 'all' ? null : parseInt(value, 10);
                // Re-render with current packets
                this.updatePacketList(Array.from(this.packets.values()));
            });
        }
        
        // Protocol filter dropdown
        if (this.protocolFilter) {
            this.protocolFilter.addEventListener('change', (e) => {
                this.protocolFilterValue = e.target.value;
                // Re-render with current packets
                this.updatePacketList(Array.from(this.packets.values()));
            });
        }
    }

    attachChatEventListeners() {
        if (this.chatSendBtn) {
            this.chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        }
        
        if (this.chatInput) {
            this.chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendChatMessage();
                }
            });
        }
    }

    startMemoryMonitoring() {
        // Update memory stats immediately
        this.updateMemoryStats();
        
        // Then update every 2 seconds
        if (this.memoryUpdateInterval) {
            clearInterval(this.memoryUpdateInterval);
        }
        this.memoryUpdateInterval = setInterval(() => this.updateMemoryStats(), 2000);
    }

    async updateMemoryStats() {
        try {
            const response = await fetch('/api/memory');
            const data = await response.json();
            
            if (data.ok) {
                const sessions = data.chatSessions.activeSessions || 0;
                const memoryKB = parseFloat(data.chatSessions.estimatedMemoryKB || 0);
                const memoryMB = parseFloat(data.chatSessions.estimatedMemoryMB || 0);
                const heapMB = parseFloat(data.processMemory.heapUsed || 0);
                
                // Update sessions
                if (this.memorySessions) {
                    this.memorySessions.textContent = sessions;
                    this.memorySessions.className = 'memory-stat-value';
                }
                
                // Update context memory usage
                if (this.memoryUsage) {
                    if (memoryMB >= 1) {
                        this.memoryUsage.textContent = `${memoryMB.toFixed(2)} MB`;
                    } else {
                        this.memoryUsage.textContent = `${memoryKB.toFixed(2)} KB`;
                    }
                    // Color code based on memory usage
                    if (memoryMB > 50) {
                        this.memoryUsage.className = 'memory-stat-value memory-critical';
                    } else if (memoryMB > 20) {
                        this.memoryUsage.className = 'memory-stat-value memory-warning';
                    } else {
                        this.memoryUsage.className = 'memory-stat-value';
                    }
                }
                
                // Update heap usage
                if (this.memoryHeap) {
                    this.memoryHeap.textContent = `${heapMB} MB`;
                    // Color code based on heap usage
                    if (heapMB > 500) {
                        this.memoryHeap.className = 'memory-stat-value memory-critical';
                    } else if (heapMB > 200) {
                        this.memoryHeap.className = 'memory-stat-value memory-warning';
                    } else {
                        this.memoryHeap.className = 'memory-stat-value';
                    }
                }
                
                // Update VRAM (model memory) - show used/total if available
                if (this.memoryVRAM && data.ollamaMemory) {
                    const usedVRAMMB = parseFloat(data.ollamaMemory.total_vram_mb || 0);
                    const totalAvailableVRAMMB = data.ollamaMemory.total_available_vram_mb 
                        ? parseFloat(data.ollamaMemory.total_available_vram_mb) 
                        : null;
                    
                    if (usedVRAMMB > 0) {
                        if (totalAvailableVRAMMB && totalAvailableVRAMMB > 0) {
                            const usagePercent = ((usedVRAMMB / totalAvailableVRAMMB) * 100).toFixed(1);
                            // Show in GB if > 1GB, otherwise MB
                            if (totalAvailableVRAMMB >= 1024) {
                                this.memoryVRAM.textContent = `${(usedVRAMMB/1024).toFixed(2)}/${(totalAvailableVRAMMB/1024).toFixed(2)} GB (${usagePercent}%)`;
                            } else {
                                this.memoryVRAM.textContent = `${usedVRAMMB.toFixed(2)}/${totalAvailableVRAMMB.toFixed(2)} MB (${usagePercent}%)`;
                            }
                            // Color code based on usage
                            const usage = parseFloat(usagePercent);
                            if (usage > 90) {
                                this.memoryVRAM.className = 'memory-stat-value memory-critical';
                            } else if (usage > 75) {
                                this.memoryVRAM.className = 'memory-stat-value memory-warning';
                            } else {
                                this.memoryVRAM.className = 'memory-stat-value';
                            }
                        } else {
                            // Just show used VRAM
                            if (usedVRAMMB >= 1024) {
                                this.memoryVRAM.textContent = `${(usedVRAMMB/1024).toFixed(2)} GB`;
                            } else {
                                this.memoryVRAM.textContent = `${usedVRAMMB.toFixed(2)} MB`;
                            }
                            this.memoryVRAM.className = 'memory-stat-value';
                        }
                    } else {
                        this.memoryVRAM.textContent = 'N/A';
                        this.memoryVRAM.className = 'memory-stat-value';
                    }
                } else if (this.memoryVRAM) {
                    this.memoryVRAM.textContent = 'N/A';
                    this.memoryVRAM.className = 'memory-stat-value';
                }
                
                // Update system RAM
                if (this.memoryRAM && data.systemMemory) {
                    const usedGB = parseFloat(data.systemMemory.used_gb || 0);
                    const totalGB = parseFloat(data.systemMemory.total_gb || 0);
                    const usagePercent = parseFloat(data.systemMemory.usage_percent || 0);
                    if (totalGB > 0) {
                        this.memoryRAM.textContent = `${usedGB}/${totalGB} GB (${usagePercent}%)`;
                        // Color code based on usage
                        if (usagePercent > 90) {
                            this.memoryRAM.className = 'memory-stat-value memory-critical';
                        } else if (usagePercent > 75) {
                            this.memoryRAM.className = 'memory-stat-value memory-warning';
                        } else {
                            this.memoryRAM.className = 'memory-stat-value';
                        }
                    } else {
                        this.memoryRAM.textContent = 'N/A';
                        this.memoryRAM.className = 'memory-stat-value';
                    }
                } else if (this.memoryRAM) {
                    this.memoryRAM.textContent = 'N/A';
                    this.memoryRAM.className = 'memory-stat-value';
                }
            }
        } catch (err) {
            console.error('Error updating memory stats:', err);
        }
    }

    async checkMonitoringStatus() {
        try {
            const response = await fetch('/api/monitoring/status');
            const data = await response.json();
            this.isMonitoring = data.is_sniffing || false;
            this.updateUI();
            
            if (this.isMonitoring) {
                this.startPacketFetching();
            }
        } catch (err) {
            console.error('Error checking status:', err);
        }
    }

    async startMonitoring() {
        try {
            const response = await fetch('/api/monitoring/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            
            if (response.ok) {
                this.isMonitoring = true;
                this.updateUI();
                this.startPacketFetching();
            } else {
                alert('Failed to start monitoring');
            }
        } catch (err) {
            console.error('Error starting monitoring:', err);
            alert('Error starting monitoring: ' + err.message);
        }
    }

    async stopMonitoring() {
        try {
            const response = await fetch('/api/monitoring/stop', {
                method: 'POST'
            });
            
            if (response.ok) {
                this.isMonitoring = false;
                this.updateUI();
                this.stopPacketFetching();
            }
        } catch (err) {
            console.error('Error stopping monitoring:', err);
        }
    }

    updateUI() {
        if (this.isMonitoring) {
            this.statusIndicator.className = 'status-indicator active';
            this.statusText.textContent = 'Monitoring';
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
        } else {
            this.statusIndicator.className = 'status-indicator stopped';
            this.statusText.textContent = 'Stopped';
            this.startBtn.disabled = false;
            this.stopBtn.disabled = true;
        }
    }

    startPacketFetching() {
        // Fetch packets immediately
        this.fetchPackets();
        
        // Then fetch every 500ms
        if (this.packetFetchInterval) {
            clearInterval(this.packetFetchInterval);
        }
        this.packetFetchInterval = setInterval(() => this.fetchPackets(), 500);
    }

    stopPacketFetching() {
        if (this.packetFetchInterval) {
            clearInterval(this.packetFetchInterval);
            this.packetFetchInterval = null;
        }
    }

    async fetchPackets() {
        try {
            const limit = this.packetLimit || 10000; // Large limit for "all"
            const response = await fetch(`/api/packets?limit=${limit}`);
            const data = await response.json();
            
            if (data.packets) {
                this.updatePacketList(data.packets);
                this.lastUpdate.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
            }
        } catch (err) {
            console.error('Error fetching packets:', err);
        }
    }

    updatePacketList(newPackets) {
        // Update our packet map
        newPackets.forEach(packet => {
            // Preserve expanded state and evaluation
            const existing = this.packets.get(packet.id);
            if (existing) {
                packet.expanded = existing.expanded;
                packet.evaluation = existing.evaluation;
                packet.confidence = existing.confidence;
                packet.severity = existing.severity;
            }
            this.packets.set(packet.id, packet);
            
            // If packet has evaluation, add to evaluated packets list
            if (packet.evaluation) {
                const existingIndex = this.evaluatedPackets.findIndex(p => p.id === packet.id);
                if (existingIndex === -1) {
                    this.evaluatedPackets.unshift(packet);
                } else {
                    this.evaluatedPackets[existingIndex] = packet;
                }
            }
        });
        
        // Update evaluated packets list display
        this.updateEvaluatedPacketsList();

        // Sort packets by timestamp (newest first)
        let sortedPackets = Array.from(this.packets.values())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Apply protocol filter
        if (this.protocolFilterValue && this.protocolFilterValue !== 'all') {
            sortedPackets = sortedPackets.filter(packet => {
                const protocol = (packet.protocol || '').toUpperCase();
                const filter = this.protocolFilterValue.toUpperCase();
                return protocol === filter || protocol.includes(filter);
            });
        }

        // Apply count filter if set
        if (this.packetLimit !== null) {
            sortedPackets = sortedPackets.slice(0, this.packetLimit);
        }

        // Update count
        this.packetCount.textContent = sortedPackets.length;

        // Render packets
        if (sortedPackets.length === 0) {
            this.packetList.innerHTML = '<div class="empty-state">No packets captured yet. Click "Start Monitoring" to begin.</div>';
            return;
        }

        this.packetList.innerHTML = sortedPackets.map(packet => 
            this.renderPacket(packet)
        ).join('');
    }

    renderPacket(packet) {
        const hasEvaluation = packet.evaluation !== undefined;
        const evaluationClass = hasEvaluation ? 'has-evaluation' : '';
        const isExpanded = hasEvaluation || packet.expanded; // Auto-expand if evaluated
        const isHighlighted = packet.highlighted ? 'highlighted' : '';
        
        return `
            <div class="packet-item ${evaluationClass} ${isHighlighted}" data-packet-id="${packet.id}">
                <div class="packet-preview">
                    <div class="packet-info">
                        <div class="packet-id">#${packet.id.substring(0, 8)}</div>
                        <div class="packet-protocol">${packet.protocol}</div>
                        <div class="packet-connection">${packet.src_ip || 'N/A'}:${packet.src_port || 'N/A'} → ${packet.dst_ip || 'N/A'}:${packet.dst_port || 'N/A'}</div>
                        <div class="packet-size">${packet.size} B</div>
                        <div class="packet-time">${new Date(packet.timestamp).toLocaleTimeString()}</div>
                    </div>
                    <div class="packet-actions">
                        <button class="btn-secondary btn-small evaluate-btn" data-packet-id="${packet.id}">Evaluate</button>
                        <button class="btn-secondary btn-small expand-btn" data-packet-id="${packet.id}">${isExpanded ? '▲' : '▼'}</button>
                    </div>
                </div>
                <div class="packet-details ${isExpanded ? 'expanded' : ''}" id="details-${packet.id}">
                    ${this.renderPacketDetails(packet)}
                    ${hasEvaluation ? this.renderEvaluation(packet) : ''}
                </div>
            </div>
        `;
    }

    renderPacketDetails(packet) {
        return `
            <div class="detail-row"><span class="detail-label">Summary:</span><span class="detail-value">${packet.summary || 'N/A'}</span></div>
            ${packet.flags ? `<div class="detail-row"><span class="detail-label">Flags:</span><span class="detail-value">${packet.flags}</span></div>` : ''}
            ${packet.payload_preview ? `<div class="detail-row"><span class="detail-label">Payload Preview:</span><span class="detail-value">${packet.payload_preview}</span></div>` : ''}
            ${packet.raw_data ? `<div class="detail-row"><span class="detail-label">Full Payload:</span><span class="detail-value" style="max-height: 200px; overflow-y: auto; display: block;">${packet.raw_data}</span></div>` : ''}
        `;
    }

    parseEvaluation(evaluationText) {
        // Parse structured evaluation text
        let confidence = null;
        let severity = null;
        let confidenceNote = '';
        let severityDescription = '';
        let packetIdentification = '';
        let threatLevel = '';
        let intent = '';
        let rationale = '';
        let contextAnalysis = '';
        let recommendations = '';
        
        // Try to extract packet identification (for reference, but not displayed)
        let idMatch = evaluationText.match(/PACKET_IDENTIFICATION:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!idMatch) {
            // Try lowercase format
            idMatch = evaluationText.match(/packet_identification:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (idMatch) {
            packetIdentification = idMatch[1].trim();
        }
        
        // Try to extract severity FIRST (it's the first required parameter)
        // First try uppercase format
        let severityMatch = evaluationText.match(/SEVERITY:\s*(\d+)/i);
        if (!severityMatch) {
            // Try lowercase format
            severityMatch = evaluationText.match(/severity:\s*(\d+)/i);
        }
        if (severityMatch) {
            severity = parseInt(severityMatch[1], 10);
        } else {
            // Fallback: try to find severity as text and convert
            // Match patterns like "severity: low", "- severity: low", etc.
            const severityTextMatch = evaluationText.match(/[-]\s*severity:\s*(low|medium|high)/i) || 
                                      evaluationText.match(/severity:\s*(low|medium|high)/i);
            if (severityTextMatch) {
                const severityText = severityTextMatch[1].toLowerCase();
                if (severityText === 'low') {
                    severity = 20;
                } else if (severityText === 'medium') {
                    severity = 50;
                } else if (severityText === 'high') {
                    severity = 80;
                }
            }
        }
        
        // Try to extract confidence SECOND (it's the second required parameter)
        // First try uppercase format
        let confidenceMatch = evaluationText.match(/CONFIDENCE:\s*(\d+)/i);
        if (!confidenceMatch) {
            // Try lowercase format
            confidenceMatch = evaluationText.match(/confidence:\s*(\d+)/i);
        }
        if (confidenceMatch) {
            confidence = parseInt(confidenceMatch[1], 10);
        }
        
        // Try to extract confidence note
        let noteMatch = evaluationText.match(/CONFIDENCE_NOTE:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!noteMatch) {
            // Try lowercase format
            noteMatch = evaluationText.match(/confidence_note:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (noteMatch) {
            confidenceNote = noteMatch[1].trim();
        }
        
        // Try to extract severity description
        let severityDescMatch = evaluationText.match(/SEVERITY_DESCRIPTION:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!severityDescMatch) {
            severityDescMatch = evaluationText.match(/severity_description:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (severityDescMatch) {
            severityDescription = severityDescMatch[1].trim();
        }
        
        // Try to extract threat level
        let threatMatch = evaluationText.match(/THREAT_LEVEL:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!threatMatch) {
            threatMatch = evaluationText.match(/threat_level:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (threatMatch) {
            threatLevel = threatMatch[1].trim();
        }
        
        // Try to extract intent
        let intentMatch = evaluationText.match(/INTENT:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!intentMatch) {
            intentMatch = evaluationText.match(/intent:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (intentMatch) {
            intent = intentMatch[1].trim();
        }
        
        // Try to extract rationale
        let rationaleMatch = evaluationText.match(/RATIONALE:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!rationaleMatch) {
            rationaleMatch = evaluationText.match(/rationale:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (rationaleMatch) {
            rationale = rationaleMatch[1].trim();
        }
        
        // Try to extract context analysis
        let contextMatch = evaluationText.match(/CONTEXT_ANALYSIS:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!contextMatch) {
            contextMatch = evaluationText.match(/context_analysis:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (contextMatch) {
            contextAnalysis = contextMatch[1].trim();
        }
        
        // Try to extract recommendations
        let recMatch = evaluationText.match(/RECOMMENDATIONS:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
        if (!recMatch) {
            recMatch = evaluationText.match(/recommendations:\s*(.+?)(?=\n[a-z_]+:|$)/is);
        }
        if (recMatch) {
            recommendations = recMatch[1].trim();
        }
        
        return { 
            confidence, 
            severity,
            confidenceNote, 
            severityDescription,
            packetIdentification,
            threatLevel,
            intent,
            rationale,
            contextAnalysis,
            recommendations
        };
    }

    getSeverityColor(severity) {
        if (severity === null) return '#ff9800'; // Default orange if unknown
        
        if (severity <= 25) {
            return '#4caf50'; // Green - harmless
        } else if (severity <= 75) {
            return '#ff9800'; // Yellow/Orange - moderate
        } else {
            return '#f44336'; // Red - very dangerous
        }
    }

    renderEvaluation(packet) {
        if (!packet.evaluation) return '';
        
        const parsed = this.parseEvaluation(packet.evaluation);
        const confidence = parsed.confidence !== null ? parsed.confidence : packet.confidence;
        const severity = parsed.severity !== null ? parsed.severity : packet.severity;
        
        // Validate required fields - if missing, show error instead of rendering
        const missingFields = [];
        if (severity === null || severity === undefined) {
            missingFields.push('SEVERITY');
        }
        if (confidence === null || confidence === undefined) {
            missingFields.push('CONFIDENCE');
        }
        
        if (missingFields.length > 0) {
            return `
                <div class="evaluation-result" style="border-left-color: #f44336; border-left-width: 4px;">
                    <h4>Error: Missing Required Parameters</h4>
                    <div class="evaluation-content" style="color: #f44336; padding: 12px; background: #2a1a1a; border-radius: 4px; border: 1px solid #f44336;">
                        AI evaluation is missing required parameters: ${missingFields.join(' and ')}. The AI model failed to include these mandatory fields.
                        <br><br>
                        <div style="margin-top: 8px; font-size: 11px; color: #aaa;">
                            Raw evaluation text:<br>
                            <pre style="background: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 10px; max-height: 200px; overflow-y: auto;">${packet.evaluation}</pre>
                        </div>
                    </div>
                </div>
            `;
        }
        
        // Use severity for color coding (how dangerous it is)
        const color = this.getSeverityColor(severity);
        
        // Store values for later use
        if (confidence !== null) {
            packet.confidence = confidence;
        }
        if (severity !== null) {
            packet.severity = severity;
        }
        
        let metricsDisplay = '';
        if (severity !== null || confidence !== null) {
            metricsDisplay = `
                <div style="display: flex; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
                    ${severity !== null ? `
                        <div class="severity-badge" style="background: ${color}; color: white; padding: 4px 8px; border-radius: 4px; display: inline-block; font-weight: 600;">
                            Severity: ${severity}%
                        </div>
                    ` : ''}
                    ${confidence !== null ? `
                        <div class="confidence-badge" style="background: #555; color: white; padding: 4px 8px; border-radius: 4px; display: inline-block; font-weight: 600;">
                            Confidence: ${confidence}%
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        let severityDescDisplay = '';
        if (parsed.severityDescription) {
            severityDescDisplay = `
                <div class="severity-description" style="margin-bottom: 8px; padding: 8px; background: #2a2a2a; border-radius: 4px; font-size: 11px; color: #ccc;">
                    <strong>Severity:</strong> ${parsed.severityDescription}
                </div>
            `;
        }
        
        let noteDisplay = '';
        if (parsed.confidenceNote) {
            noteDisplay = `
                <div class="confidence-note" style="margin-bottom: 8px; padding: 8px; background: #2a2a2a; border-radius: 4px; font-size: 11px; font-style: italic; color: #ccc;">
                    <strong>Confidence Note:</strong> ${parsed.confidenceNote}
                </div>
            `;
        }
        
        // Build structured display if we have parsed fields
        let structuredDisplay = '';
        if (parsed.intent || parsed.rationale || parsed.contextAnalysis || parsed.recommendations) {
            structuredDisplay = `
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #333;">
                    ${parsed.intent ? `<div style="margin-bottom: 8px;"><strong>Intent:</strong> ${parsed.intent}</div>` : ''}
                    ${parsed.rationale ? `<div style="margin-bottom: 8px;"><strong>Rationale:</strong> ${parsed.rationale}</div>` : ''}
                    ${parsed.contextAnalysis ? `<div style="margin-bottom: 8px;"><strong>Context Analysis:</strong> ${parsed.contextAnalysis}</div>` : ''}
                    ${parsed.recommendations ? `<div style="margin-bottom: 8px;"><strong>Recommendations:</strong> ${parsed.recommendations}</div>` : ''}
                </div>
            `;
        }
        
        return `
            <div class="evaluation-result" style="border-left-color: ${color}; border-left-width: 4px;">
                <h4>AI Evaluation</h4>
                ${metricsDisplay}
                ${severityDescDisplay}
                ${noteDisplay}
                ${structuredDisplay}
                ${structuredDisplay ? '' : `<div class="evaluation-content">${packet.evaluation}</div>`}
            </div>
        `;
    }

    // Attach event listeners after rendering
    attachPacketEventListeners() {
        // Only attach once using a flag
        if (this._listenersAttached) return;
        this._listenersAttached = true;
        
        // Expand/collapse details and highlight - use event delegation to avoid re-attaching
        this.packetList.addEventListener('click', (e) => {
            if (e.target.classList.contains('expand-btn')) {
                e.stopPropagation();
                const packetId = e.target.dataset.packetId;
                const packet = this.packets.get(packetId);
                const detailsEl = document.getElementById(`details-${packetId}`);
                if (detailsEl && packet) {
                    const isExpanded = detailsEl.classList.contains('expanded');
                    if (isExpanded) {
                        detailsEl.classList.remove('expanded');
                        e.target.textContent = '▼';
                        packet.expanded = false;
                    } else {
                        detailsEl.classList.add('expanded');
                        e.target.textContent = '▲';
                        packet.expanded = true;
                    }
                    this.packets.set(packetId, packet);
                }
            } else if (e.target.classList.contains('evaluate-btn')) {
                e.stopPropagation();
                const packetId = e.target.dataset.packetId;
                this.evaluatePacket(packetId);
            } else {
                // Click on packet item itself - highlight and show in sidebar
                const packetItem = e.target.closest('.packet-item');
                if (packetItem && !e.target.closest('.packet-actions')) {
                    const packetId = packetItem.dataset.packetId;
                    this.highlightPacket(packetId);
                }
            }
        });
    }

    highlightPacket(packetId) {
        // Remove highlight from all packets
        document.querySelectorAll('.packet-item').forEach(item => {
            item.classList.remove('highlighted');
            const id = item.dataset.packetId;
            if (id) {
                const packet = this.packets.get(id);
                if (packet) {
                    packet.highlighted = false;
                    this.packets.set(id, packet);
                }
            }
        });
        
        // Highlight selected packet
        const packet = this.packets.get(packetId);
        if (packet) {
            packet.highlighted = true;
            this.packets.set(packetId, packet);
            
            const packetEl = document.querySelector(`[data-packet-id="${packetId}"]`);
            if (packetEl) {
                packetEl.classList.add('highlighted');
                packetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            
            // Expand details
            const detailsEl = document.getElementById(`details-${packetId}`);
            if (detailsEl) {
                detailsEl.classList.add('expanded');
                packet.expanded = true;
            }
            
            // Update sidebar if packet has evaluation
            if (packet.evaluation) {
                this.currentChatPacketId = packetId;
                this.updateSidebar(packet, packet.evaluation);
                this.showChatInterface(packetId);
                this.loadChatHistory(packetId);
            } else {
                // Just show packet info in sidebar
                this.updateSidebarForPacket(packet);
            }
        }
    }

    updateSidebarForPacket(packet) {
        if (!this.lastEvaluatedContent) return;
        
        this.lastEvaluatedContent.innerHTML = `
            <div class="evaluated-packet-info">
                <h3 style="font-size: 13px; color: #4a9eff; margin-bottom: 8px;">Packet Information</h3>
                <div class="evaluated-packet-details" style="font-size: 11px;">
                    <div class="detail-row"><span class="detail-label">ID:</span><span class="detail-value">${packet.id}</span></div>
                    <div class="detail-row"><span class="detail-label">Timestamp:</span><span class="detail-value">${new Date(packet.timestamp).toLocaleString()}</span></div>
                    <div class="detail-row"><span class="detail-label">Protocol:</span><span class="detail-value">${packet.protocol}</span></div>
                    <div class="detail-row"><span class="detail-label">Source:</span><span class="detail-value">${packet.src_ip || 'N/A'}:${packet.src_port || 'N/A'}</span></div>
                    <div class="detail-row"><span class="detail-label">Destination:</span><span class="detail-value">${packet.dst_ip || 'N/A'}:${packet.dst_port || 'N/A'}</span></div>
                    <div class="detail-row"><span class="detail-label">Size:</span><span class="detail-value">${packet.size} bytes</span></div>
                    ${packet.flags ? `<div class="detail-row"><span class="detail-label">Flags:</span><span class="detail-value">${packet.flags}</span></div>` : ''}
                    <div class="detail-row"><span class="detail-label">Summary:</span><span class="detail-value">${packet.summary || 'N/A'}</span></div>
                </div>
            </div>
            <div style="margin-top: 15px; padding: 15px; background: #252525; border-radius: 4px; text-align: center;">
                <button class="btn-primary" onclick="window.packetAnalyzer.evaluatePacket('${packet.id}')" style="width: 100%;">Evaluate This Packet</button>
            </div>
        `;
        
        // Hide chat interface
        this.hideChatInterface();
    }

    async evaluatePacket(packetId) {
        const packet = this.packets.get(packetId);
        if (!packet) return;

        // Show loading state
        const packetEl = document.querySelector(`[data-packet-id="${packetId}"]`);
        if (packetEl) {
            const detailsEl = packetEl.querySelector('.packet-details');
            if (detailsEl) {
                detailsEl.classList.add('expanded');
                detailsEl.innerHTML = this.renderPacketDetails(packet) + 
                    '<div class="evaluation-result"><h4>AI Evaluation</h4><div class="evaluation-content evaluation-loading"><span class="loading-spinner"></span>AI is analyzing packet... This may take a few moments.</div></div>';
            }
        }

        try {
            const before = parseInt(this.contextBefore?.value || 5, 10);
            const after = parseInt(this.contextAfter?.value || 5, 10);
            
            const requestBody = { packetId, before, after };
            console.log('=== SENDING EVALUATION REQUEST ===');
            console.log('Request body:', requestBody);
            console.log('===================================');
            
            const response = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            
            if (data.ok) {
                // Parse and store evaluation
                packet.evaluation = data.evaluation;
                const parsed = this.parseEvaluation(data.evaluation);
                
                // Validate that severity and confidence are present (they are required)
                const missingFields = [];
                if (parsed.severity === null || parsed.severity === undefined) {
                    missingFields.push('SEVERITY');
                }
                if (parsed.confidence === null || parsed.confidence === undefined) {
                    missingFields.push('CONFIDENCE');
                }
                
                if (missingFields.length > 0) {
                    const errorMsg = `AI evaluation is missing required parameters: ${missingFields.join(' and ')}. The AI model failed to include these mandatory fields. Please try evaluating again.`;
                    if (packetEl) {
                        const detailsEl = packetEl.querySelector('.packet-details');
                        if (detailsEl) {
                            detailsEl.innerHTML = this.renderPacketDetails(packet) + 
                                `<div class="evaluation-result"><h4>Error: Missing Required Parameters</h4><div class="evaluation-content" style="color: #f44336; padding: 12px; background: #2a1a1a; border-radius: 4px; border: 1px solid #f44336;">${errorMsg}<br><br><div style="margin-top: 8px; font-size: 11px; color: #aaa;">Raw evaluation text:<br><pre style="background: #1a1a1a; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 10px;">${data.evaluation}</pre></div></div></div>`;
                        }
                    }
                    return; // Don't proceed with storing invalid evaluation
                }
                
                // Store validated values
                if (parsed.confidence !== null) {
                    packet.confidence = parsed.confidence;
                }
                if (parsed.severity !== null) {
                    packet.severity = parsed.severity;
                }
                packet.expanded = true; // Auto-expand evaluated packets
                this.packets.set(packetId, packet);
                
                // Add to evaluated packets list if not already there
                const existingIndex = this.evaluatedPackets.findIndex(p => p.id === packetId);
                if (existingIndex === -1) {
                    this.evaluatedPackets.unshift(packet); // Add to beginning (newest first)
                } else {
                    // Update existing entry
                    this.evaluatedPackets[existingIndex] = packet;
                }
                
                // Update UI
                this.updatePacketList(Array.from(this.packets.values()));
                
                // Update sidebar
                this.updateSidebar(packet, data.evaluation);
                this.updateEvaluatedPacketsList();
            } else {
                throw new Error(data.error || 'Evaluation failed');
            }
        } catch (err) {
            console.error('Error evaluating packet:', err);
            if (packetEl) {
                const detailsEl = packetEl.querySelector('.packet-details');
                if (detailsEl) {
                    detailsEl.innerHTML = this.renderPacketDetails(packet) + 
                        `<div class="evaluation-result"><h4>Error</h4><div class="evaluation-content" style="color: #f44336;">${err.message}</div></div>`;
                }
            }
        }
    }

    updateEvaluatedPacketsList() {
        if (!this.evaluatedPacketsContainer) return;
        
        if (this.evaluatedPackets.length === 0) {
            this.evaluatedPacketsContainer.innerHTML = '<div class="empty-state" style="padding: 20px; font-size: 12px;">No packets evaluated yet</div>';
            if (this.evaluatedCount) {
                this.evaluatedCount.textContent = '0';
            }
            return;
        }
        
        if (this.evaluatedCount) {
            this.evaluatedCount.textContent = this.evaluatedPackets.length;
        }
        
        this.evaluatedPacketsContainer.innerHTML = this.evaluatedPackets.map((packet, index) => {
            const parsed = this.parseEvaluation(packet.evaluation || '');
            const severity = parsed.severity !== null ? parsed.severity : packet.severity;
            const confidence = parsed.confidence !== null ? parsed.confidence : packet.confidence;
            const color = this.getSeverityColor(severity);
            
            return `
                <div class="evaluated-packet-item" data-packet-id="${packet.id}" style="
                    background: #252525;
                    border: 1px solid #333;
                    border-left: 3px solid ${color};
                    border-radius: 4px;
                    padding: 8px;
                    margin-bottom: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                " onmouseover="this.style.background='#2a2a2a'; this.style.borderColor='#4a9eff';" onmouseout="this.style.background='#252525'; this.style.borderColor='#333';">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <div style="font-size: 11px; color: #888; font-family: 'Courier New', monospace;">
                            #${packet.id.substring(0, 8)}
                        </div>
                        <div style="font-size: 10px; color: #666;">
                            ${new Date(packet.timestamp).toLocaleTimeString()}
                        </div>
                    </div>
                    <div style="font-size: 12px; color: #4a9eff; font-weight: 600; margin-bottom: 4px;">
                        ${packet.protocol}
                    </div>
                    <div style="font-size: 11px; color: #aaa; margin-bottom: 4px;">
                        ${packet.src_ip || 'N/A'}:${packet.src_port || 'N/A'} → ${packet.dst_ip || 'N/A'}:${packet.dst_port || 'N/A'}
                    </div>
                    <div style="display: flex; gap: 6px; margin-top: 6px;">
                        ${severity !== null ? `
                            <div style="background: ${color}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;">
                                S: ${severity}%
                            </div>
                        ` : ''}
                        ${confidence !== null ? `
                            <div style="background: #555; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: 600;">
                                C: ${confidence}%
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
        
        // Attach click listeners to evaluated packet items
        this.evaluatedPacketsContainer.querySelectorAll('.evaluated-packet-item').forEach(item => {
            item.addEventListener('click', () => {
                const packetId = item.dataset.packetId;
                this.highlightPacket(packetId);
                const packet = this.packets.get(packetId);
                if (packet && packet.evaluation) {
                    this.currentChatPacketId = packetId; // Set current chat packet
                    this.updateSidebar(packet, packet.evaluation);
                    this.showChatInterface(packetId);
                    this.loadChatHistory(packetId);
                }
            });
        });
    }

    updateSidebar(packet, evaluation) {
        this.lastEvaluatedPacket = { packet, evaluation };
        this.currentChatPacketId = packet.id; // Set current chat packet
        
        if (!this.lastEvaluatedContent) return;
        
        const parsed = this.parseEvaluation(evaluation);
        const confidence = parsed.confidence !== null ? parsed.confidence : packet.confidence;
        const severity = parsed.severity !== null ? parsed.severity : packet.severity;
        const color = this.getSeverityColor(severity);
        
        let metricsDisplay = '';
        if (severity !== null || confidence !== null) {
            metricsDisplay = `
                <div style="display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
                    ${severity !== null ? `
                        <div style="background: ${color}; color: white; padding: 6px 12px; border-radius: 4px; display: inline-block; font-weight: 600;">
                            Severity: ${severity}%
                        </div>
                    ` : ''}
                    ${confidence !== null ? `
                        <div style="background: #555; color: white; padding: 6px 12px; border-radius: 4px; display: inline-block; font-weight: 600;">
                            Confidence: ${confidence}%
                        </div>
                    ` : ''}
                </div>
            `;
        }
        
        this.lastEvaluatedContent.innerHTML = `
            <div class="evaluated-packet-info">
                <h3 style="font-size: 13px; color: #4a9eff; margin-bottom: 8px;">Packet Information</h3>
                <div class="evaluated-packet-details" style="font-size: 11px;">
                    <div class="detail-row"><span class="detail-label">ID:</span><span class="detail-value">${packet.id}</span></div>
                    <div class="detail-row"><span class="detail-label">Timestamp:</span><span class="detail-value">${new Date(packet.timestamp).toLocaleString()}</span></div>
                    <div class="detail-row"><span class="detail-label">Protocol:</span><span class="detail-value">${packet.protocol}</span></div>
                    <div class="detail-row"><span class="detail-label">Source:</span><span class="detail-value">${packet.src_ip || 'N/A'}:${packet.src_port || 'N/A'}</span></div>
                    <div class="detail-row"><span class="detail-label">Destination:</span><span class="detail-value">${packet.dst_ip || 'N/A'}:${packet.dst_port || 'N/A'}</span></div>
                    <div class="detail-row"><span class="detail-label">Size:</span><span class="detail-value">${packet.size} bytes</span></div>
                    ${packet.flags ? `<div class="detail-row"><span class="detail-label">Flags:</span><span class="detail-value">${packet.flags}</span></div>` : ''}
                    <div class="detail-row"><span class="detail-label">Summary:</span><span class="detail-value">${packet.summary || 'N/A'}</span></div>
                </div>
            </div>
            <div class="evaluation-display" style="border-left: 4px solid ${color}; margin-top: 15px; padding-left: 10px;">
                <h3 style="font-size: 13px; color: #ff9800; margin-bottom: 8px;">AI Evaluation</h3>
                ${metricsDisplay}
                ${parsed.severityDescription ? `<div style="margin-bottom: 10px; padding: 8px; background: #2a2a2a; border-radius: 4px; font-size: 11px; color: #ccc;"><strong>Severity:</strong> ${parsed.severityDescription}</div>` : ''}
                ${parsed.confidenceNote ? `<div style="margin-bottom: 10px; padding: 8px; background: #2a2a2a; border-radius: 4px; font-size: 11px; font-style: italic; color: #ccc;"><strong>Confidence Note:</strong> ${parsed.confidenceNote}</div>` : ''}
                ${parsed.intent ? `<div style="margin-bottom: 8px; font-size: 11px;"><strong>Intent:</strong> ${parsed.intent}</div>` : ''}
                ${parsed.rationale ? `<div style="margin-bottom: 8px; font-size: 11px;"><strong>Rationale:</strong> ${parsed.rationale}</div>` : ''}
                ${parsed.contextAnalysis ? `<div style="margin-bottom: 8px; font-size: 11px;"><strong>Context Analysis:</strong> ${parsed.contextAnalysis}</div>` : ''}
                ${parsed.recommendations ? `<div style="margin-bottom: 8px; font-size: 11px;"><strong>Recommendations:</strong> ${parsed.recommendations}</div>` : ''}
                ${!parsed.intent && !parsed.rationale ? `<div class="evaluation-text" style="font-size: 11px;">${evaluation}</div>` : ''}
            </div>
        `;
        
        // Show chat interface and load chat history
        this.showChatInterface(packet.id);
        this.loadChatHistory(packet.id);
    }

    showChatInterface(packetId) {
        if (this.chatContainer && this.chatPlaceholder) {
            this.chatContainer.style.display = 'flex';
            this.chatPlaceholder.style.display = 'none';
        }
    }

    hideChatInterface() {
        if (this.chatContainer && this.chatPlaceholder) {
            this.chatContainer.style.display = 'none';
            this.chatPlaceholder.style.display = 'block';
        }
    }

    async loadChatHistory(packetId) {
        if (!this.chatMessages) return;
        
        try {
            const response = await fetch(`/api/chat/${packetId}`);
            const data = await response.json();
            
            if (data.ok && data.messages && data.messages.length > 0) {
                // Filter out the initial evaluation (we only want follow-up Q&A)
                // The initial evaluation is: user (evaluation request) + assistant (evaluation response)
                // So we skip the first 2 messages and show the rest
                const chatOnlyMessages = data.messages.slice(2); // Skip initial evaluation
                
                if (chatOnlyMessages.length > 0) {
                    this.renderChatMessages(chatOnlyMessages);
                } else {
                    this.chatMessages.innerHTML = '<div class="chat-placeholder">Ask questions about the evaluated packet...</div>';
                }
            } else {
                this.chatMessages.innerHTML = '<div class="chat-placeholder">Ask questions about the evaluated packet...</div>';
            }
        } catch (err) {
            console.error('Error loading chat history:', err);
            this.chatMessages.innerHTML = '<div class="chat-placeholder">Ask questions about the evaluated packet...</div>';
        }
    }

    renderChatMessages(messages) {
        if (!this.chatMessages) return;
        
        if (messages.length === 0) {
            this.chatMessages.innerHTML = '<div class="chat-placeholder">Ask questions about the evaluated packet...</div>';
            return;
        }
        
        this.chatMessages.innerHTML = messages.map(msg => {
            const role = msg.role === 'user' ? 'user' : 'assistant';
            const label = msg.role === 'user' ? 'You' : 'AI';
            return `
                <div class="chat-message ${role}">
                    <div class="chat-message-label">${label}</div>
                    <div>${this.escapeHtml(msg.content)}</div>
                </div>
            `;
        }).join('');
        
        // Scroll to bottom
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async sendChatMessage() {
        if (!this.currentChatPacketId) {
            alert('No packet selected for chat. Please evaluate a packet first.');
            return;
        }
        
        const question = this.chatInput?.value?.trim();
        if (!question) return;
        
        // Disable input while sending
        if (this.chatInput) this.chatInput.disabled = true;
        if (this.chatSendBtn) this.chatSendBtn.disabled = true;
        
        // Add user message to chat immediately
        const userMessage = { role: 'user', content: question };
        const currentMessages = Array.from(this.chatMessages.querySelectorAll('.chat-message'));
        const existingMessages = currentMessages.map(el => {
            const label = el.querySelector('.chat-message-label')?.textContent;
            const content = el.querySelector('div:last-child')?.textContent;
            return {
                role: label === 'You' ? 'user' : 'assistant',
                content: content
            };
        });
        
        existingMessages.push(userMessage);
        this.renderChatMessages(existingMessages);
        
        // Clear input
        if (this.chatInput) this.chatInput.value = '';
        
        // Show loading indicator
        const loadingMsg = { role: 'assistant', content: 'Thinking...' };
        existingMessages.push(loadingMsg);
        this.renderChatMessages(existingMessages);
        
        try {
            const response = await fetch('/api/chat/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    packetId: this.currentChatPacketId,
                    question: question
                })
            });
            
            const data = await response.json();
            
            if (data.ok) {
                // Remove loading message and add real response
                existingMessages.pop(); // Remove loading
                existingMessages.push({ role: 'assistant', content: data.answer });
                this.renderChatMessages(existingMessages);
            } else {
                throw new Error(data.error || 'Failed to get response');
            }
        } catch (err) {
            console.error('Error sending chat message:', err);
            // Remove loading message and show error
            existingMessages.pop(); // Remove loading
            existingMessages.push({ role: 'assistant', content: `Error: ${err.message}` });
            this.renderChatMessages(existingMessages);
        } finally {
            // Re-enable input
            if (this.chatInput) this.chatInput.disabled = false;
            if (this.chatSendBtn) this.chatSendBtn.disabled = false;
            if (this.chatInput) this.chatInput.focus();
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const analyzer = new PacketAnalyzer();
    // Make analyzer globally accessible for onclick handlers
    window.packetAnalyzer = analyzer;
});

