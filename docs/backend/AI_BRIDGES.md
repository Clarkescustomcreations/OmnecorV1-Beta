# Omnecor AI Bridges (Hardware Integration Layer)

Omnecor's Hardware Integration Layer is a defining feature that bridges the gap between digital AI workflows and physical engineering tasks. This is achieved through specialized Python bridges managed by the backend's `ProcessManagerService`.

## 1. Architecture of the Bridge System

The bridge system is designed to securely and reliably execute specialized tasks using external tools that are not natively available within the Node.js environment.

```mermaid
graph LR
    A[Frontend UI] -->|tRPC Request| B(Backend Router)
    B --> C(ProcessManagerService)
    C -->|Spawns & Manages| D[Python Bridge Script]
    D -->|Interacts with| E(External Tool/Hardware)
    D -->|Streams Output (JSON)| C
    C -->|WebSocket Broadcast| A
```

### 1.1. ProcessManagerService

The `ProcessManagerService` is the orchestrator for all Python bridges. Its responsibilities include:

-   **Process Spawning**: Initiating Python scripts as child processes.
-   **Lifecycle Management**: Monitoring process health, handling timeouts, and ensuring clean termination.
-   **I/O Handling**: Capturing standard output (stdout) and standard error (stderr) from the Python scripts.
-   **Data Parsing**: Parsing JSON-formatted output from the bridges to extract structured data, progress updates, and error messages.

### 1.2. Python Bridge Scripts

The actual integration logic resides in Python scripts located in the `server/python_bridges/` directory. These scripts act as intermediaries, translating commands from Omnecor into actions performed by the target tool.

## 2. Supported Bridges

### 2.1. Blender Bridge (`blender_bridge.py`)

-   **Purpose**: Integrates with Blender for 3D modeling, rendering, and scene manipulation tasks.
-   **Use Cases**:
    -   Automated rendering of 3D scenes.
    -   AI-driven generation or modification of 3D assets.
    -   Extracting metadata or geometry from Blender files.
-   **Execution**: The bridge script is typically executed using Blender's headless mode (`blender -b -P blender_bridge.py`).

### 2.2. KiCad Bridge (`kicad_bridge.py`)

-   **Purpose**: Integrates with KiCad for Printed Circuit Board (PCB) design and engineering workflows.
-   **Use Cases**:
    -   Automated PCB routing or component placement.
    -   Extracting Bill of Materials (BOM) or netlists.
    -   AI-assisted design rule checking (DRC).
-   **Execution**: Leverages KiCad's Python API (`pcbnew`) to interact with project files.

### 2.3. ESPTool Bridge (`esptool_bridge.py`)

-   **Purpose**: Interfaces with `esptool.py` for flashing firmware to ESP8266 and ESP32 microcontrollers.
-   **Use Cases**:
    -   Automated deployment of compiled firmware to connected devices.
    -   Reading device MAC addresses or flash information.
    -   Erasing flash memory.
-   **Execution**: Wraps the `esptool` command-line utility, providing a structured interface for Omnecor.

### 2.4. Fal.ai Bridge (`fal_bridge.py`)

-   **Purpose**: Connects to Fal.ai services for high-performance, cloud-based media generation.
-   **Use Cases**:
    -   Fast image generation (e.g., using SDXL or similar models).
    -   Video generation or processing.
-   **Execution**: Utilizes the Fal.ai Python client library to interact with their API.

### 2.5. RVC Server (`rvc_server.py`)

-   **Purpose**: Handles Real-time Voice Cloning (RVC) services.
-   **Use Cases**:
    -   Voice conversion and cloning for audio generation.
-   **Execution**: Runs as a local server providing an API for voice processing tasks.

## 3. Communication Protocol

Communication between the `ProcessManagerService` and the Python bridges relies on standard input/output streams.

-   **Input**: The backend passes arguments and configuration data to the Python script via command-line arguments or environment variables.
-   **Output**: The Python scripts are designed to output structured JSON data to `stdout`. This allows the `ProcessManagerService` to easily parse progress updates, results, and error messages, which are then relayed to the frontend via WebSockets.

## 4. Security Considerations

-   **Isolation**: Python bridges run as separate processes, providing a degree of isolation from the main Node.js server.
-   **Input Validation**: The backend rigorously validates all inputs before passing them to the bridge scripts to prevent command injection vulnerabilities.
-   **Resource Limits**: The `ProcessManagerService` can enforce timeouts and resource limits on child processes to prevent them from consuming excessive system resources.
