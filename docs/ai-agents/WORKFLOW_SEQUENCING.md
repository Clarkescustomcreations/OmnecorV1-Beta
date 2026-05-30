# Omnecor AI Agent Workflow Sequencing

Effective orchestration of autonomous AI agents requires robust workflow sequencing mechanisms. Omnecor provides capabilities for defining, executing, and monitoring multi-step agent workflows, ensuring tasks are completed efficiently and reliably. This document outlines the principles and components involved in AI agent workflow sequencing.

## 1. Principles of Workflow Orchestration

Omnecor's approach to workflow sequencing is built on several core principles:

-   **Modularity**: Workflows are composed of discrete, reusable steps or sub-tasks, each potentially handled by a specialized agent.
-   **Dependency Management**: The system understands and manages dependencies between tasks, ensuring that prerequisites are met before execution.
-   **Action Hashing**: To ensure idempotence and prevent redundant computations, Omnecor employs action hashing, where the output of a step is cached if its inputs and action remain unchanged.
-   **Loop Detection**: Mechanisms are in place to detect and manage infinite loops within workflows, preventing resource exhaustion.
-   **Human-In-The-Loop (HITL)**: Critical junctures in workflows can be configured for human review and approval, ensuring quality control and safety.
-   **Resilience**: Workflows are designed to be resilient to failures, with mechanisms for retries, error handling, and recovery.

## 2. Workflow Definition

Workflows in Omnecor are typically defined as a sequence of actions, often represented as a directed acyclic graph (DAG) where nodes are tasks and edges represent dependencies. While a visual workflow builder is planned for future phases, current definitions might involve structured configurations or programmatic definitions.

## 3. Execution Flow

### 3.1. Task Initiation

Workflows can be initiated by various triggers:

-   **User Command**: Direct invocation from the Omnecor UI.
-   **Event Trigger**: Responding to file system changes (via `FileSystemWatcherService`), incoming messages, or scheduled events.
-   **Agent Decision**: An AI agent initiating a sub-workflow as part of a larger task.

### 3.2. Agent Assignment

Once a task is initiated, the system identifies the appropriate agent(s) responsible for the initial step. This assignment is based on the agent's defined responsibilities and capabilities (as outlined in `AGENT_RESPONSIBILITIES.md`).

### 3.3. Step Execution

Each step in the workflow involves an agent performing a specific action. This could include:

-   Interacting with AI models (via `AiProviderService`).
-   Accessing the knowledge base (via `VectorDBService`).
-   Executing external tools (via `ProcessManagerService` and Python bridges).
-   Generating content or code.
-   Communicating with other Omnecor nodes (via OMMESH).

### 3.4. Action Hashing and Caching

Before executing a step, Omnecor calculates a hash of the action's inputs and parameters. If a matching hash is found in the cache, and the output is still valid, the previous result is retrieved, skipping redundant computation. This significantly speeds up iterative workflows.

### 3.5. Loop Detection

During execution, the workflow engine monitors for patterns that indicate an infinite loop. If a loop is detected, the workflow can be paused, terminated, or flagged for human intervention, depending on configuration.

### 3.6. Human-In-The-Loop (HITL) Approval

For critical steps, the workflow can pause and await approval from a human operator. The `HITLApprovalService` manages this process, presenting the context and proposed action to the user and resuming the workflow upon approval.

### 3.7. Progress Monitoring and Reporting

Throughout the execution, the workflow engine broadcasts progress updates via the WebSocket API. This allows the frontend to display real-time status, logs, and intermediate results to the user.

## 4. Error Handling and Recovery

Robust error handling is built into the workflow sequencing:

-   **Retries**: Failed steps can be configured to automatically retry a specified number of times.
-   **Fallback Actions**: If a step consistently fails, fallback actions (e.g., notifying a human, attempting an alternative approach) can be defined.
-   **State Preservation**: The state of ongoing workflows is preserved, allowing for recovery from application restarts or unexpected interruptions.
-   **Logging**: Detailed logs are generated for each step, aiding in diagnosis and debugging of workflow failures.

## 5. Multi-Agent Collaboration

Workflows often involve multiple agents collaborating. The sequencing mechanisms ensure that agents can hand off tasks, share context, and synchronize their efforts effectively. For more details, refer to `MULTI_AGENT_COLLABORATION.md`.
