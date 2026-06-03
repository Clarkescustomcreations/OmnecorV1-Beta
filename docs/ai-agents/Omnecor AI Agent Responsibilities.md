# Omnecor AI Agent Responsibilities

Omnecor leverages a multi-modal workforce of autonomous AI agents, each designed with specific responsibilities to execute complex tasks across various domains. This document outlines the general principles governing agent responsibilities and provides examples of specialized agent roles within the Omnecor ecosystem.

## 1. Principles of Agent Responsibility

Each AI agent within Omnecor is designed with a clear mandate, ensuring efficient task execution and preventing conflicts. Key principles include:

-   **Clear Mandate**: Every agent has a defined purpose and a set of capabilities it is responsible for.
-   **Bounded Scope**: Agents operate within a specific domain or set of tasks, preventing overreach and ensuring focus.
-   **Task Ownership**: For any given task, there should be a primary agent responsible for its execution, even if it requires collaboration with other agents.
-   **Collaboration**: Agents are designed to collaborate, passing information and sub-tasks to other specialized agents as needed.
-   **Validation**: Agents are often equipped with validation pipelines to ensure the quality and correctness of their outputs.

## 2. Valet Router Dispatch

The **1.5B Valet Router** (Qwen2.5-1.5B-Instruct) acts as the intelligent dispatch layer for all agent assignments. It classifies every incoming task into one of 13 categories (code_generation, code_review, research, synthesis, media_generation, knowledge_retrieval, instruction_writing, integration, hardware, reporting, context_management, memory_operations, local_task) and routes to the most appropriate agent or model based on the user's configured routing mode. See [VALET_ROUTER.md](VALET_ROUTER.md) for the full taxonomy and routing modes.

## 3. General Agent Roles

While specific agents can be highly specialized, they often fall into broader categories:

### 3.1. Orchestration Agents

-   **Purpose**: Oversee and coordinate the activities of other agents, manage workflows, and ensure task completion.
-   **Responsibilities**:
    -   Breaking down complex goals into smaller, manageable sub-tasks.
    -   Assigning sub-tasks to appropriate specialized agents.
    -   Monitoring the progress of sub-tasks.
    -   Handling dependencies and sequencing of operations.
    -   Aggregating results from multiple agents.

### 3.2. Knowledge Agents

-   **Purpose**: Manage and retrieve information from the knowledge base, ensuring other agents have access to relevant context.
-   **Responsibilities**:
    -   Indexing new documents and data into the `VectorDBService`.
    -   Performing semantic search and retrieval based on agent queries.
    -   Summarizing and synthesizing information for other agents.
    -   Maintaining the integrity and freshness of the knowledge base.

### 3.3. Creative Agents

-   **Purpose**: Generate new content, designs, or media based on given prompts and constraints.
-   **Responsibilities**:
    -   Generating images, videos, or audio using integrated AI models (e.g., ComfyUI, Fal.ai).
    -   Assisting with 3D modeling or design tasks (e.g., via Blender bridge).
    -   Producing written content (e.g., code, documentation, fiction).

### 3.4. Engineering Agents

-   **Purpose**: Interact with codebases, hardware, and technical systems to build, test, or deploy solutions.
-   **Responsibilities**:
    -   Writing, debugging, and refactoring code.
    -   Interacting with hardware (e.g., flashing firmware via ESPTool bridge).
    -   Managing PCB designs (e.g., via KiCad bridge).
    -   Automating deployment and testing processes.

## 4. Memory and Context Operations

Two specialized agent roles handle the memory and context management systems:

### 4.1. Memory Operations Agent

-   **Responsibilities**:
    -   Storing and retrieving durable user facts via Honcho (`/btw` command integration).
    -   Managing cross-session memory persistence using the `HonchoService`.
    -   Injecting recent facts into chat system prompts for continuity across sessions.
    -   Monitoring fact freshness and suggesting updates when project context changes.
-   **Integration**: Routes via the `memory_operations` category in the Valet Router taxonomy.

### 4.2. Context Management Agent

-   **Responsibilities**:
    -   Managing hierarchical context (Goal & Plan buffer, conversation history, rolling log).
    -   Summarizing old terminal log entries when they exceed 50 lines.
    -   Responding to `/compress` commands and selective message exclusion requests.
    -   Monitoring token budget and alerting when approaching limits (70% amber, 90% red).
    -   Pruning low-priority context when hard limits are reached.
-   **Integration**: Routes via the `context_management` category in the Valet Router taxonomy.

## 5. Example Specialized Agents

### 5.1. Documentation Agent

-   **Responsibilities**:
    -   Updating `README.md` and other root-level documentation files.
    -   Generating and maintaining API documentation.
    -   Creating and updating architecture documentation.
-   **Boundaries**: Must not modify runtime code directly.

### 5.2. Code Generation Agent

-   **Responsibilities**:
    -   Generating code snippets or full modules based on specifications.
    -   Ensuring generated code adheres to coding standards.
    -   Integrating generated code into the existing codebase.
-   **Boundaries**: Requires Human-In-The-Loop (HITL) approval for critical code changes.

### 5.3. Hardware Flashing Agent

-   **Responsibilities**:
    -   Executing firmware flashing operations using the ESPTool bridge.
    -   Verifying successful firmware deployment.
    -   Reporting device status.
-   **Boundaries**: Requires explicit user confirmation before initiating flashing operations to prevent accidental data loss or device damage.

## 4. Agent Boundaries and Task Ownership

-   **Clear Boundaries**: Each agent operates within defined boundaries, preventing unintended side effects or conflicts with other agents.
-   **Task Ownership**: When multiple agents might be capable of a task, a clear hierarchy or negotiation protocol ensures that only one agent takes primary ownership, coordinating with others as necessary.
-   **Shared Memory Systems**: Agents can access shared memory systems (e.g., the VectorDB) to share information and context, facilitating collaboration without direct inter-agent communication for every piece of data.
-   **File Locking**: Mechanisms are in place to prevent multiple agents from simultaneously modifying the same files, ensuring data integrity.

## 5. Validation Pipelines

Agents often incorporate validation steps to ensure the quality of their work. This can include:

-   **Code Linting and Testing**: For code-generating agents.
-   **Design Rule Checks**: For hardware design agents.
-   **Semantic Consistency Checks**: For knowledge and documentation agents.

This structured approach to agent responsibilities ensures that Omnecor's multi-agent system operates efficiently, reliably, and safely.
