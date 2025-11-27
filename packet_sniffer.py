#!/usr/bin/env python3
"""
Packet sniffer using scapy to capture network packets and send them to the backend.
Filters out websocket connections to avoid hearing the project's own traffic.
"""

import json
import time
import threading
from datetime import datetime
from collections import deque
from scapy.all import sniff, IP, TCP, UDP, ARP, ICMP, Raw
from scapy.layers.inet6 import IPv6
import uuid

# Configuration
WEBSOCKET_PORT = 5173  # Port used by the websocket server

# Note: On Windows, you need Npcap installed (not WinPcap)
# Download from: https://nmap.org/npcap/

class PacketSniffer:
    def __init__(self):
        self.packets = deque(maxlen=10000)  # Keep last 10k packets in memory
        self.is_sniffing = False
        self.sniff_thread = None
        self.packet_lock = threading.Lock()
        self.packet_counter = 0
        
    def get_packet_info(self, packet):
        """Extract comprehensive packet information for analysis."""
        packet_id = str(uuid.uuid4())
        timestamp = datetime.now().isoformat()
        
        # Get packet size safely
        try:
            packet_size = len(packet)
        except:
            packet_size = 0
        
        info = {
            "id": packet_id,
            "timestamp": timestamp,
            "summary": "",
            "protocol": "Unknown",
            "src_ip": None,
            "dst_ip": None,
            "src_port": None,
            "dst_port": None,
            "size": packet_size,
            "flags": None,
            "payload_preview": None,
            "raw_data": None
        }
        
        # Extract IP layer info
        if IP in packet:
            ip_layer = packet[IP]
            info["src_ip"] = ip_layer.src
            info["dst_ip"] = ip_layer.dst
            info["protocol"] = ip_layer.proto
            
            # TCP
            if TCP in packet:
                tcp = packet[TCP]
                info["src_port"] = tcp.sport
                info["dst_port"] = tcp.dport
                info["protocol"] = "TCP"
                info["flags"] = str(tcp.flags)
                
                # Check if this is a websocket connection (exclude it)
                if (tcp.sport == WEBSOCKET_PORT or tcp.dport == WEBSOCKET_PORT):
                    return None
                
                # Payload preview
                if Raw in packet:
                    payload = bytes(packet[Raw].load)
                    info["payload_preview"] = payload[:100].hex() if len(payload) > 0 else None
                    info["raw_data"] = payload.hex()
                
                info["summary"] = f"TCP {ip_layer.src}:{tcp.sport} -> {ip_layer.dst}:{tcp.dport} [{tcp.flags}]"
            
            # UDP
            elif UDP in packet:
                udp = packet[UDP]
                info["src_port"] = udp.sport
                info["dst_port"] = udp.dport
                info["protocol"] = "UDP"
                
                if Raw in packet:
                    payload = bytes(packet[Raw].load)
                    info["payload_preview"] = payload[:100].hex() if len(payload) > 0 else None
                    info["raw_data"] = payload.hex()
                
                info["summary"] = f"UDP {ip_layer.src}:{udp.sport} -> {ip_layer.dst}:{udp.dport}"
            
            # ICMP
            elif ICMP in packet:
                icmp = packet[ICMP]
                info["protocol"] = "ICMP"
                info["summary"] = f"ICMP {ip_layer.src} -> {ip_layer.dst} type={icmp.type}"
        
        # IPv6
        elif IPv6 in packet:
            ipv6 = packet[IPv6]
            info["src_ip"] = ipv6.src
            info["dst_ip"] = ipv6.dst
            info["protocol"] = "IPv6"
            info["summary"] = f"IPv6 {ipv6.src} -> {ipv6.dst}"
        
        # ARP
        elif ARP in packet:
            arp = packet[ARP]
            info["protocol"] = "ARP"
            info["src_ip"] = arp.psrc
            info["dst_ip"] = arp.pdst
            info["summary"] = f"ARP {arp.psrc} -> {arp.pdst}"
        
        else:
            # Try to get a summary even for unknown packets
            try:
                info["summary"] = f"Unknown protocol: {packet.summary()}"
            except:
                info["summary"] = "Unknown/Unsupported packet type"
        
        # Add full packet hex dump for detailed analysis
        try:
            info["packet_hex"] = packet.hex()
        except:
            try:
                info["packet_hex"] = bytes(packet).hex()
            except:
                info["packet_hex"] = ""
        
        return info
    
    def packet_handler(self, packet):
        """Handle each captured packet."""
        if not self.is_sniffing:
            return
        
        try:
            packet_info = self.get_packet_info(packet)
            if packet_info is None:  # Filtered out (e.g., websocket)
                return
            
            with self.packet_lock:
                self.packets.append(packet_info)
                self.packet_counter += 1
                
            # Debug: print first few packets
            if self.packet_counter <= 5:
                print(f"Captured packet #{self.packet_counter}: {packet_info['summary']}")
        except Exception as e:
            print(f"Error processing packet: {e}")
            import traceback
            traceback.print_exc()
    
    def start_sniffing(self, interface=None):
        """Start packet sniffing in a separate thread."""
        if self.is_sniffing:
            print("Sniffing already in progress")
            return False
        
        self.is_sniffing = True
        print(f"Starting packet capture on interface: {interface or 'default'}")
        
        def sniff_loop():
            try:
                print("Sniffing loop started, waiting for packets...")
                # Use a loop with timeout to allow periodic checking of is_sniffing
                while self.is_sniffing:
                    try:
                        # Sniff with a short timeout so we can check is_sniffing periodically
                        # This allows us to stop even when no packets are arriving
                        sniff(
                            prn=self.packet_handler,
                            count=0,  # Capture all packets until timeout or stop_filter
                            store=False,
                            iface=interface,
                            timeout=1,  # Check every 1 second
                            stop_filter=lambda p: not self.is_sniffing
                        )
                        # After timeout, check if we should continue
                        if not self.is_sniffing:
                            break
                    except Exception as sniff_err:
                        # Check if we should stop
                        if not self.is_sniffing:
                            break
                        error_str = str(sniff_err).lower()
                        # Timeout exceptions are expected and fine
                        if "timeout" in error_str:
                            continue
                        # Other errors might be serious
                        print(f"Sniffing error: {sniff_err}")
                        # Don't print full traceback for timeouts
                        if "timeout" not in error_str:
                            import traceback
                            traceback.print_exc()
                        # Continue trying
                        time.sleep(0.5)
                print("Sniffing stopped normally")
            except KeyboardInterrupt:
                print("Sniffing interrupted by user")
                self.is_sniffing = False
            except Exception as e:
                print(f"Fatal sniffing error: {e}")
                import traceback
                traceback.print_exc()
                self.is_sniffing = False
                # On Windows, might need Npcap - provide helpful error
                error_str = str(e).lower()
                if "win" in error_str or "npcap" in error_str or "permission" in error_str:
                    print("\n" + "="*60)
                    print("ERROR: Packet capture requires:")
                    print("  - On Windows: Npcap must be installed")
                    print("    Download from: https://nmap.org/npcap/")
                    print("  - On Linux/Mac: Run with sudo/root privileges")
                    print("="*60)
        
        self.sniff_thread = threading.Thread(target=sniff_loop, daemon=True)
        self.sniff_thread.start()
        print("Sniffing thread started")
        return True
    
    def stop_sniffing(self):
        """Stop packet sniffing."""
        self.is_sniffing = False
        return True
    
    def get_packets(self, limit=100):
        """Get recent packets."""
        with self.packet_lock:
            return list(self.packets)[-limit:]
    
    def get_packet_by_id(self, packet_id):
        """Get a specific packet by ID."""
        with self.packet_lock:
            for pkt in self.packets:
                if pkt["id"] == packet_id:
                    return pkt
        return None
    
    def get_packet_context(self, packet_id, before=5, after=5):
        """Get a packet and its context (before/after packets)."""
        with self.packet_lock:
            packets_list = list(self.packets)
            for i, pkt in enumerate(packets_list):
                if pkt["id"] == packet_id:
                    start_idx = max(0, i - before)
                    end_idx = min(len(packets_list), i + after + 1)
                    return packets_list[start_idx:end_idx]
        return []


# Flask server to serve packet data
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

sniffer = PacketSniffer()

@app.route("/api/packets", methods=["GET"])
def get_packets():
    """Get recent packets."""
    limit = request.args.get("limit", 100, type=int)
    packets = sniffer.get_packets(limit)
    return jsonify({"packets": packets, "count": len(packets)})


@app.route("/api/packets/<packet_id>", methods=["GET"])
def get_packet(packet_id):
    """Get a specific packet by ID."""
    packet = sniffer.get_packet_by_id(packet_id)
    if packet:
        return jsonify(packet)
    return jsonify({"error": "Packet not found"}), 404

@app.route("/api/packets/<packet_id>/context", methods=["GET"])
def get_packet_context(packet_id):
    """Get packet with context (before/after)."""
    before = request.args.get("before", 10, type=int)
    after = request.args.get("after", 10, type=int)
    context = sniffer.get_packet_context(packet_id, before, after)
    if context:
        return jsonify({"packets": context, "count": len(context)})
    return jsonify({"error": "Packet not found"}), 404

@app.route("/api/monitoring/start", methods=["POST"])
def start_monitoring():
    """Start packet monitoring."""
    try:
        interface = request.json.get("interface") if request.json else None
        success = sniffer.start_sniffing(interface)
        return jsonify({
            "status": "started" if success else "already_running",
            "is_sniffing": sniffer.is_sniffing
        })
    except Exception as e:
        print(f"Error starting monitoring: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route("/api/monitoring/stop", methods=["POST"])
def stop_monitoring():
    """Stop packet monitoring."""
    sniffer.stop_sniffing()
    return jsonify({"status": "stopped"})

@app.route("/api/monitoring/status", methods=["GET"])
def monitoring_status():
    """Get monitoring status."""
    with sniffer.packet_lock:
        packet_list_size = len(sniffer.packets)
    return jsonify({
        "is_sniffing": sniffer.is_sniffing,
        "packet_count": sniffer.packet_counter,
        "packets_in_memory": packet_list_size
    })

@app.route("/api/test", methods=["GET"])
def test_endpoint():
    """Test endpoint to verify server is running."""
    try:
        from scapy.all import get_if_list, conf
        interfaces = get_if_list()
        default_iface = conf.iface
    except Exception as e:
        interfaces = [f"Error getting interfaces: {e}"]
        default_iface = "unknown"
    
    with sniffer.packet_lock:
        packet_count = len(sniffer.packets)
    
    return jsonify({
        "status": "ok",
        "sniffer_initialized": sniffer is not None,
        "is_sniffing": sniffer.is_sniffing if sniffer else False,
        "packet_counter": sniffer.packet_counter if sniffer else 0,
        "packets_in_memory": packet_count,
        "available_interfaces": interfaces,
        "default_interface": str(default_iface)
    })

if __name__ == "__main__":
    print("=" * 60)
    print("Starting packet sniffer server on http://localhost:5000")
    print("Make sure to run with appropriate permissions:")
    print("  - Linux/Mac: sudo python3 packet_sniffer.py")
    print("  - Windows: Run as Administrator")
    print("=" * 60)
    
    # Test if we can import scapy properly and list interfaces
    try:
        from scapy.all import get_if_list, conf
        interfaces = get_if_list()
        print(f"\nAvailable network interfaces: {interfaces}")
        if interfaces:
            print(f"Default interface: {conf.iface}")
        else:
            print("WARNING: No network interfaces found!")
            print("This might indicate a permissions or driver issue.")
    except Exception as e:
        print(f"\nWarning: Could not list interfaces: {e}")
        print("Make sure Scapy is properly installed and you have the required permissions")
        import traceback
        traceback.print_exc()
    
    # Test if we can actually capture a packet (quick test)
    print("\nTesting packet capture capability...")
    try:
        from scapy.all import sniff
        # Try to capture one packet with a very short timeout
        test_packets = sniff(count=1, timeout=0.1, store=True)
        if len(test_packets) > 0:
            print("✓ Packet capture test successful!")
        else:
            print("⚠ No packets captured in test (this is normal if network is idle)")
    except Exception as e:
        error_str = str(e).lower()
        if "permission" in error_str or "access" in error_str:
            print("✗ Permission denied - you need administrator/root privileges!")
        elif "npcap" in error_str or "winpcap" in error_str:
            print("✗ Npcap/WinPcap not found!")
            print("  On Windows, install Npcap from: https://nmap.org/npcap/")
        else:
            print(f"⚠ Packet capture test failed: {e}")
            print("  This might be normal - packets will be captured when monitoring starts")
    
    print("\n" + "=" * 60)
    print("Server starting...")
    print("=" * 60 + "\n")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)

