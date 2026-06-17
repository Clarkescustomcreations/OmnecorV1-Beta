# OMMESH Distributed LAN Inference Mesh Setup Guide

This guide explains how to set up, secure, and run OMMESH, the decentralized local-area network (LAN) inference federation layer within Omnecor.

OMMESH enables multiple Omnecor workstations and mobile nodes to securely connect, share compute resources, and route LLM inference requests to the machine with the most available VRAM.

---

## 1. How OMMESH Works

OMMESH operates as a secure, local-first federation:
1. **mDNS Auto-Discovery**: Nodes dynamically announce themselves and locate peers on the LAN using Bonjour/mDNS on port `3000` (web server) and port `3001` (mesh port).
2. **strict-mTLS Mutual Authentication**: Communication between nodes is encrypted using TLS v1.3. Connections are only accepted if both nodes possess certificates signed by the shared federation authority.
3. **VRAM-Weighted Routing**: The mesh monitors available VRAM across all active nodes. A scheduler routes inference requests to the node best equipped to handle them.
4. **Sovereign-Mode Enforcement**: Cloud-based procedures (e.g., OpenAI, Anthropic) are blocked from being routed through the mesh. The federation only distributes local compute.

---

## 2. Prerequisites

- **Local Area Network (LAN)**: All devices must be on the same subnet (or connected via a shared Tailscale Virtual LAN).
- **Firewall Exceptions**:
  - Allow inbound/outbound mDNS traffic (UDP port `5353`).
  - Allow TCP port `3001` (default OMMESH port) on all workstation nodes.
- **Shared Secret**: A consistent `OMMESH_SECRET` key must be configured on all nodes.

---

## 3. Configuration Steps

### 3.1. Workstation Node Setup (PC / Linux / Mac)

On every desktop workstation joining the mesh:
1. Open the `.env` file in the project root.
2. Define the shared mesh secret:
   ```bash
   OMMESH_SECRET="your_secure_mesh_secret_string"
   ```
   *Note: This secret must be identical across all nodes. Keep this key confidential.*
3. Ensure `OMNECOR_HOST` is set to `0.0.0.0` to bind to your LAN IP.
4. Restart the Omnecor workstation.

### 3.2. Android Phone Node Setup (Mobile App)

To connect the mobile companion app as a compute node:
1. Sideload the standalone `app-release.apk` onto your device.
2. Ensure your phone is connected to the same Wi-Fi network (or Tailscale VPN) as your workstation.
3. Open the **Omnecor HQ App** and navigate to the **Settings** tab.
4. Enter the same **OMMESH Secret** you defined on the workstation.
5. Sinks and configs will automatically sync. The Snapdragon NPU/CPU on-device engine (`llama.rn`) will register itself to the network.

---

## 4. Discovery & Verification

Once configured, nodes discover each other automatically.

### 4.1. Sidebar Indicators
Look at the footer of the desktop workspace sidebar. When peers are discovered, the **Mesh Peer Card** will light up showing:
- Active peer hostnames (e.g., `omnecor-workstation-2.local`).
- Round-trip ping latency (ms).
- Number of locally served models on each peer.

### 4.2. Routing Verification
To verify that inference is correctly routing:
1. Set the model provider selector to **OMMESH** in your Chat Panel.
2. Send a prompt (e.g., "Analyze this code block").
3. Inspect the response footer. The UI will print the node that executed the inference:
   ```
   Executed by: omnecor-desktop-2 (via OMMESH)
   ```
4. If the remote node fails or goes offline, the scheduler automatically falls back to local execution.

---

## 5. Security & Trust Model

- **Certificate Pinning**: Upon successful authentication, nodes pin peer certificate fingerprints. Any attempt to intercept traffic using a spoofed certificate is rejected.
- **Timing-Attack Protection**: The WebSocket handshake performs Timing-Safe comparison (`timingSafeEqual`) on the OMMESH secret hash to prevent brute-force extraction.
- **Fail-Closed Behavior**: If `OMMESH_SECRET` is undefined, the mesh listener shuts down immediately, refusing all inbound LAN socket upgrades.
