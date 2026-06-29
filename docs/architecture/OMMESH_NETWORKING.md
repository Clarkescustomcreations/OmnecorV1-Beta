# OMMESH Networking & Cross-Node Routing

Omnecor utilizes a proprietary decentralized mesh networking protocol known as **OMMESH** to distribute local AI compute across multiple devices on the same Local Area Network (LAN). 

## Architecture

The OMMESH protocol is driven by two main components: `MeshDiscoveryService` and `MeshServer`. 
Together, they establish a secure, air-gapped, zero-configuration local network allowing lightweight clients (e.g., mobile devices, laptops) to offload heavy inference tasks to powerful workstation nodes.

### 1. Discovery (`MeshDiscoveryService`)
- Nodes discover each other using multicast DNS (mDNS).
- Authentication for discovery relies on a shared `OMMESH_SECRET` stored in the node's `.env` or SecureStore (mobile).
- If the secret matches, nodes exchange identity and capability manifests.

### 2. Transport & Security (`MeshServer` & mTLS)
- Inference requests are routed via strict mutual TLS (mTLS) over HTTPS on the advertised `MESH_PORT` (default: 3001).
- `MeshServer.ts` enforces `requestCert: true`, `rejectUnauthorized: true`, and strictly requires `TLSv1.3`.
- **Certificate Pinning:** When `MeshNode.routeToRemote()` makes a call, it uses `getClientTlsOptions()` to pin the peer's advertised certificate fingerprint, immediately rejecting any MITM attempts with alternate CA-signed certs.

## Routing Execution Path

When a user submits a prompt, `MeshNode.routeInference()` determines the optimal node:

1. **Local Execution (`executeLocal`)**:
   - Executes inference directly using the local instance's `AiProviderService.chat()`.
2. **Remote Routing (`routeToRemote`)**:
   - Forwards the request over mTLS.
   - The remote node receives a `POST /inference` payload and executes it locally, returning the stream/response.
   - The remote node also exposes a `GET /health` endpoint for liveness checks.

## Sovereign-Mode Enforcement
OMMESH distributes **local compute only**. The `executeLocal()` function explicitly rejects tunneling for cloud providers (e.g., `openai`, `anthropic`, `gemini`). A cloud call cannot be bypassed through the mesh network if the executing node is in Sovereign mode.

## Supported Artifacts
OMMESH has been validated across all major platforms:
- **Linux:** AppImage, `.deb` packages.
- **Windows:** Native installer.
- **Android:** Standalone compiled APK (React Native HQ).
