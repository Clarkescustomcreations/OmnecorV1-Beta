# Omnecor Multi-Agent Collaboration Workflows

Omnecor is designed to facilitate sophisticated multi-agent collaboration, enabling autonomous AI agents to work together on complex tasks. This document outlines the mechanisms, protocols, and best practices for orchestrating workflows involving multiple agents.

## 1. Principles of Multi-Agent Collaboration

Effective multi-agent collaboration in Omnecor is built upon several foundational principles:

-   **Specialization**: Agents are designed with distinct responsibilities and capabilities, allowing them to excel in specific domains (e.g., code generation, media creation, knowledge retrieval).
-   **Shared Context**: Agents operate within a shared understanding of the project and its goals, facilitated by the `MemoryArchitectService` and `VectorDBService`.
-   **Task Decomposition**: Complex tasks are broken down into smaller, manageable sub-tasks that can be distributed among specialized agents.
-   **Communication Protocols**: Agents communicate through well-defined protocols, often mediated by an orchestration layer, to exchange information, request assistance, and report progress.
-   **Conflict Resolution**: Mechanisms are in place to detect and resolve potential conflicts or overlapping responsibilities between agents.
-   **Human-In-The-Loop (HITL)**: Human oversight can be integrated at critical junctures to guide, approve, or correct agent actions.

## 2. Collaboration Mechanisms

### 2.1. Orchestration Layer

The `AgentService` and `WorkflowSequencing` mechanisms (as described in `WORKFLOW_SEQUENCING.md`) form the core orchestration layer. This layer is responsible for:

-   **Task Assignment**: Assigning sub-tasks to the most appropriate agent based on its capabilities.
-   **Dependency Management**: Ensuring that agents execute tasks in the correct order, respecting dependencies.
-   **Progress Monitoring**: Tracking the status of each agent's contribution to the overall workflow.
-   **Result Aggregation**: Collecting and synthesizing outputs from multiple agents.

### 2.2. Shared Memory and Knowledge Base

Agents leverage Omnecor's shared memory systems to maintain a consistent view of the project and collaborate effectively:

-   **VectorDBService**: Agents can query the `VectorDBService` to retrieve semantically relevant information from the project's knowledge base, ensuring they have access to the necessary context for their tasks.
-   **MemoryArchitectService**: Manages hierarchical context with three levels: permanent Goal & Plan buffer (never pruned), conversation history (pruned by token limits), and rolling terminal log (auto-summarized at 50 entries). Ensures collective project context is available across all agents.
-   **HonchoService**: Cross-session memory layer persisting user facts and preferences. Recent facts are injected into the system prompt on new sessions, allowing agents to build upon historical context and user preferences across disconnected conversations.

### 2.3. Communication and Hand-offs

Agents communicate and hand off tasks through structured messages or by updating shared project state.

-   **Structured Messages**: Agents can send messages to each other (or to the orchestration layer) containing task requests, data, or status updates. These messages often follow predefined schemas.
-   **Shared State Updates**: Agents can update shared project data (e.g., modifying a node in the Neural Brain Map, adding a file to a project directory), which other agents can then react to via `FileSystemWatcherService` or direct queries.

### 2.4. File Locking and Merge Procedures

To prevent data corruption and ensure consistency when multiple agents might interact with the same resources:

-   **File Locking**: Mechanisms are implemented to prevent simultaneous write access to critical files, ensuring that only one agent can modify a file at a time.
-   **Merge Procedures**: For scenarios where concurrent modifications are possible, merge procedures (potentially involving HITL) are used to reconcile changes and resolve conflicts.

## 3. Example Workflows

### 3.1. Documentation Generation Workflow

Consider a workflow for generating comprehensive documentation for a new feature:

1.  **Orchestrator Agent**: Initiates the documentation task for a new feature.
2.  **Code Analysis Agent**: Analyzes the new feature's codebase, identifying functions, classes, and their purposes. It might generate initial code summaries and API endpoints.
3.  **Architecture Agent**: Reviews the system design documents and the new feature's integration points, generating architectural diagrams or descriptions.
4.  **User Guide Agent**: Takes the output from the Code Analysis and Architecture Agents, along with user stories, to draft sections of the user guide, explaining how to use the new feature.
5.  **Documentation Agent**: Collects all generated content, formats it according to brand guidelines, and updates the relevant Markdown files (e.g., `README.md`, `docs/api/TRPC_API.md`, `docs/user-guides/USER_GUIDE.md`).
6.  **Review (HITL)**: The Orchestrator Agent pauses the workflow and requests human review of the generated documentation before final publication.

---

### 3.2. Valet-Routed Multi-API Research-to-Implementation Workflow

The following illustrates how the 1.5B Valet Router orchestrates a complex multi-domain task when running in `multi_api` or `multi_api_omesh` mode. The Valet analyzes the incoming task, classifies it into sub-tasks using its 10-category taxonomy, and dispatches each sub-task to the most appropriate provider or local model.

> **Note:** All model names below are illustrative examples only. Omnecor is provider-agnostic — you configure your own API pool.

**User Request:** *"Research and implement a new authentication flow"*

| Phase | Agent(s) | Task | Notes |
|---|---|---|---|
| **1. Research** | Grok Agent, Gemini Agent | Current auth standards, CVEs, RFCs, academic research | Can run one or both simultaneously |
| **2. Synthesis** | OpenAI Agent, Gemini Agent | Write synthesis document; cross-reference and fact-check | One or both |
| **3. Context Comparison** | 1.5B Valet and/or OMMESH Model, API Model | Query Neural Brain Map for existing project context; compare against synthesis | Local-first |
| **4. Instruction Writing** | 1.5B Valet or OMMESH Model, API Model | Generate detailed step-by-step implementation instructions | Local preferred; API for complex architectures |
| **5. Code Generation** | Claude Agent, Grok Agent, Gemini Agent | Core logic + security review + test generation | One or any combination |
| **6. Integration** | 1.5B Valet and/or OMMESH Model, API Model | Merge generated code into project; resolve conflicts | Local-first |
| **7. Report** | 1.5B Valet or API Model | Summarize results, update `todo.md` and `status.md`, offer skill packaging | |

**Key principle:** The Valet selects agents based on task classification — not on a fixed assignment. If only one provider is configured, it handles all phases. If an OMMESH network is available, background phases (research, knowledge retrieval) are offloaded to peer nodes while the local chain handles foreground work.

For the full routing mode reference and taxonomy, see [VALET_ROUTER.md](VALET_ROUTER.md).

## 4. OMMESH and Distributed Collaboration

In an OMMESH environment, multi-agent collaboration can extend across multiple Omnecor nodes.

-   **Distributed Task Execution**: Agents on different nodes can contribute to a single workflow, leveraging the collective compute resources of the mesh.
-   **Shared Knowledge**: The `MeshDiscoveryService` and `RoutingEngine` facilitate the sharing of knowledge and context across the distributed network, allowing agents to access resources from any connected node.
-   **Secure Communication**: All inter-node agent communication is secured via mTLS, ensuring data integrity and confidentiality.

### 4.4. Valet + OMMESH Task Sequencing

In `moe_chain_omesh` and `multi_api_omesh` modes, the order of task dispatch matters:

1. **OMMESH tasks are dispatched first.** Network inference takes time to initialize; dispatching these first ensures they are already running before the local chain begins.
2. **Local tasks start second.** Once OMMESH nodes confirm receipt, the 1.5B Valet begins the local processing chain.
3. **Results merge asynchronously.** OMMESH outputs return as they complete and are merged into the workflow by the Valet as they arrive.

This sequencing rule is hardcoded in the Valet Router's dispatch logic to prevent the local chain from consuming compute resources that the routing layer needs for OMMESH coordination.

## 5. Best Practices for Designing Collaborative Agents

-   **Define Clear Interfaces**: Agents should expose clear interfaces for their capabilities and expected inputs/outputs.
-   **Handle Failures Gracefully**: Agents should be designed to handle errors and communicate failures back to the orchestrator.
-   **Be Idempotent**: Where possible, agent actions should be idempotent, meaning performing the action multiple times has the same effect as performing it once.
-   **Provide Status Updates**: Agents should regularly report their progress and status to the orchestration layer to enable real-time monitoring.
-   **Respect Boundaries**: Agents must respect their defined boundaries and not attempt to perform tasks outside their mandate without explicit instruction or collaboration with a responsible agent.
