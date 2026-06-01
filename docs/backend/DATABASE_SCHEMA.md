# Omnecor Database Schema

Omnecor utilizes Drizzle ORM for its database interactions, providing a type-safe and robust way to manage application data. The schema is defined in `drizzle/schema.ts` and supports MySQL/TiDB. This document outlines the key tables and their relationships within the Omnecor database.

## 1. Overview

The database schema is designed to support core application functionalities, including user management, chat sessions, and message persistence. It is structured to be extensible, allowing for the addition of new tables as the product evolves.

## 2. Table Definitions

### 2.1. `users` Table

This table stores core user information, backing the authentication flow. It is designed to be extended with additional user-related data as needed.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `int` | Surrogate primary key. Auto-incremented numeric value. | `PRIMARY KEY`, `AUTO_INCREMENT` |
| `openId` | `varchar(64)` | Manus OAuth identifier (openId) from OAuth callback. | `NOT NULL`, `UNIQUE` |
| `name` | `text` | User's display name. | |
| `email` | `varchar(320)` | User's email address. | |
| `loginMethod` | `varchar(64)` | Method used for user login. Supports `'manus'`, `'google'`, `'microsoft'`, `'local'`. | |
| `role` | `enum('viewer', 'user', 'admin', 'owner')` | User's role within the system. | `NOT NULL`, `DEFAULT 'user'` |
| `executionMode` | `mysqlEnum('executionMode', ['sovereign', 'scrapper', 'big_spender'])` | Controls which execution mode this user prefers. | `NOT NULL`, `DEFAULT 'scrapper'` |
| `createdAt` | `timestamp` | Timestamp of user creation. | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` |
| `updatedAt` | `timestamp` | Timestamp of last update to user record. | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` |
| `lastSignedIn` | `timestamp` | Timestamp of the user's last sign-in. | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` |

### 2.2. `chat_sessions` Table

This table represents individual conversation threads with an AI provider, enabling chat persistence.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | Unique identifier for the chat session (UUID). | `PRIMARY KEY` |
| `projectId` | `varchar(64)` | Identifier for the project associated with the chat session. | `NOT NULL` |
| `title` | `text` | Title or brief description of the chat session. | `NOT NULL` |
| `providerId` | `varchar(64)` | Identifier of the AI provider used for the session. | `NOT NULL` |
| `modelId` | `varchar(64)` | Identifier of the specific AI model used for the session. | `NOT NULL` |
| `systemPrompt` | `text` | The system prompt used to initialize the chat session. | |
| `metadata` | `json` | JSON object for storing additional session metadata. | |
| `createdAt` | `timestamp` | Timestamp of session creation. | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` |
| `updatedAt` | `timestamp` | Timestamp of last update to session record. | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` |

### 2.3. `chat_messages` Table

This table stores individual messages within a chat session, maintaining the conversation history.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | Unique identifier for the message (UUID). | `PRIMARY KEY` |
| `sessionId` | `varchar(36)` | Foreign key referencing the `chat_sessions` table. | `NOT NULL`, `REFERENCES chat_sessions(id) ON DELETE CASCADE` |
| `role` | `enum('system', 'user', 'assistant', 'tool', 'function')` | Role of the message sender. | `NOT NULL` |
| `content` | `text` | The content of the message (text or JSON for tool calls). | `NOT NULL` |
| `tokenCount` | `int` | Number of tokens in the message content. | |
| `createdAt` | `timestamp` | Timestamp of message creation. | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` |

### 2.4. `integrations` Table

Stores per-user OAuth tokens for third-party provider integrations (e.g. Google, Microsoft, Lithic). Tokens are stored encrypted using AES-GCM.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | UUID | `PRIMARY KEY` |
| `provider` | `varchar(64)` | OAuth provider name (e.g. `'google'`, `'microsoft'`, `'lithic'`) | `NOT NULL` |
| `accessToken` | `text` | Encrypted access token | `NOT NULL` |
| `refreshToken` | `text` | Encrypted refresh token | |
| `expiresAt` | `timestamp` | Token expiry | |
| `tokenIv` | `varchar(64)` | AES-GCM IV used for token encryption | |
| `tokenTag` | `varchar(64)` | AES-GCM authentication tag | |
| `createdAt` | `timestamp` | Timestamp of record creation | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP` |
| `updatedAt` | `timestamp` | Timestamp of last update | `NOT NULL`, `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` |

### 2.5. `project_budgets` Table

Defines per-project spending limits and alerting behaviour. The `mode` column controls whether the budget acts as a soft warning or a hard block.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | UUID | `PRIMARY KEY` |
| `projectId` | `varchar(64)` | Associated project identifier | `NOT NULL` |
| `limitCents` | `int` | Hard limit in cents. `0` = unlimited. | `NOT NULL`, `DEFAULT 0` |
| `alertThreshold` | `int` | Alert trigger as a percentage (e.g. `80` = 80%) | `NOT NULL`, `DEFAULT 80` |
| `mode` | `enum('soft', 'hard')` | `soft` = alert only; `hard` = block + auto-downgrade to Ollama | `NOT NULL`, `DEFAULT 'soft'` |
| `createdAt` | `timestamp` | Timestamp of record creation | `NOT NULL` |
| `updatedAt` | `timestamp` | Timestamp of last update | `NOT NULL` |

### 2.6. `spend_log` Table

> **INSERT-ONLY.** No `UPDATE` or `DELETE` is ever performed on this table. It is an immutable ledger of AI provider spend per session.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | UUID | `PRIMARY KEY` |
| `projectId` | `varchar(64)` | Project this spend belongs to | `NOT NULL` |
| `provider` | `varchar(64)` | AI provider (e.g. `'openai'`, `'anthropic'`, `'ollama'`) | `NOT NULL` |
| `modelId` | `varchar(64)` | Model identifier | `NOT NULL` |
| `promptTokens` | `int` | Input token count | `NOT NULL`, `DEFAULT 0` |
| `completionTokens` | `int` | Output token count | `NOT NULL`, `DEFAULT 0` |
| `estimatedCostMicrocents` | `bigint` | Cost estimate in microcents (1/100 of a cent) for precision | `NOT NULL`, `DEFAULT 0` |
| `sessionId` | `varchar(36)` | Optional link to `chat_sessions` | |
| `createdAt` | `timestamp` | Timestamp of record creation | `NOT NULL` |

### 2.7. `audit_log` Table

> **INSERT-ONLY (append-only).** No `UPDATE` or `DELETE` is ever performed. Sensitive data is redacted before insertion via `redactSensitiveData()`.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | UUID | `PRIMARY KEY` |
| `eventType` | `varchar(64)` | Event type string (e.g. `'user.login'`, `'hitl.approved'`, `'agent.spawned'`) | `NOT NULL` |
| `actorId` | `int` | FK to `users.id`. `NULL` for system-initiated events. | |
| `actorType` | `varchar(32)` | `'user'`, `'agent'`, or `'system'` | `NOT NULL`, `DEFAULT 'user'` |
| `procedure` | `varchar(128)` | tRPC procedure path that triggered the event | |
| `args` | `json` | Redacted input arguments | |
| `result` | `json` | Redacted result summary | |
| `ipAddress` | `varchar(64)` | Client IP address | |
| `sessionId` | `varchar(36)` | Associated chat or pipeline session | |
| `createdAt` | `timestamp` | Timestamp of record creation | `NOT NULL` |

Captured event types include: `user.login`, `user.logout`, `hitl.approved`, `hitl.rejected`, `agent.spawned`, `agent.terminated`, `budget.changed`, `card.issued`, `tool.blender`, `tool.kicad`, `tool.esptool`.

### 2.8. `pipelines` Table

Represents a top-level multi-phase execution pipeline, progressing through DEFINE → PLAN → EXECUTE → REVIEW → SHIP → DONE.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | UUID | `PRIMARY KEY` |
| `name` | `varchar(128)` | Human-readable pipeline name | `NOT NULL` |
| `goal` | `text` | High-level goal description for the pipeline | |
| `status` | `enum('pending', 'running', 'paused', 'complete', 'aborted')` | Overall pipeline status | `NOT NULL`, `DEFAULT 'pending'` |
| `currentPhase` | `enum('DEFINE', 'PLAN', 'EXECUTE', 'REVIEW', 'SHIP', 'DONE')` | Active phase of the pipeline | `NOT NULL`, `DEFAULT 'DEFINE'` |
| `ownerId` | `int` | FK to `users.id`. User who owns this pipeline. | |
| `createdAt` | `timestamp` | Timestamp of record creation | `NOT NULL` |
| `updatedAt` | `timestamp` | Timestamp of last update | `NOT NULL` |

### 2.9. `pipeline_phases` Table

Stores per-phase state and HITL approval records for a pipeline run. Phases are deleted when their parent pipeline is deleted.

| Column Name | Type | Description | Constraints |
|---|---|---|---|
| `id` | `varchar(36)` | UUID | `PRIMARY KEY` |
| `pipelineId` | `varchar(36)` | FK to `pipelines.id` | `NOT NULL`, `REFERENCES pipelines(id) ON DELETE CASCADE` |
| `phase` | `enum('DEFINE', 'PLAN', 'EXECUTE', 'REVIEW', 'SHIP')` | Phase identifier | `NOT NULL` |
| `status` | `enum('pending', 'awaiting_approval', 'approved', 'rejected', 'complete')` | Phase status | `NOT NULL`, `DEFAULT 'pending'` |
| `inputText` | `text` | Input provided to this phase | |
| `outputText` | `text` | Output produced by this phase | |
| `approvedBy` | `int` | FK to `users.id`. User who approved this phase. | |
| `approvedAt` | `timestamp` | Timestamp of approval | |
| `createdAt` | `timestamp` | Timestamp of record creation | `NOT NULL` |
| `updatedAt` | `timestamp` | Timestamp of last update | `NOT NULL` |

## 3. Relationships

-   **`chat_messages` to `chat_sessions`**: A one-to-many relationship where multiple `chat_messages` can belong to a single `chat_session`. The `sessionId` in `chat_messages` is a foreign key referencing `chat_sessions.id`, with `ON DELETE CASCADE` ensuring that messages are deleted when their parent session is removed.
-   **`project_budgets` to `projects`**: Many-to-one via `projectId`. A project may have at most one active budget record.
-   **`spend_log` to `project_budgets`**: Many-to-one via `projectId`. All spend entries for a project roll up against that project's budget.
-   **`audit_log` to `users`**: Many-to-one via `actorId` (nullable). System-initiated events have `actorId = NULL`.
-   **`pipeline_phases` to `pipelines`**: Many-to-one via `pipelineId`, with `ON DELETE CASCADE` ensuring phases are removed when their parent pipeline is deleted.

## 4. Migrations

Database schema changes are managed through Drizzle Kit migrations. The `drizzle/migrations` directory contains SQL files representing these changes, ensuring that the database schema can be evolved systematically and reliably.

## 5. Execution Modes

The `users.executionMode` column is the persistence layer for Omnecor's three provider-routing modes. The active mode is enforced server-side on every tRPC call.

| Mode | Behaviour |
|---|---|
| `sovereign` | All cloud provider procedures are **blocked server-side** by the `sovereignCheck` middleware. Only local models (Ollama, local Whisper, etc.) may be used. |
| `scrapper` *(default)* | Local models are **preferred**; cloud providers are used as a fallback when a local model cannot satisfy the request. |
| `big_spender` | High-performance cloud models (e.g. GPT-4o, Claude Opus) are **preferred by default**. Local models are only used when a cloud provider is unavailable or explicitly overridden per-request. |

When a `hard` budget limit is hit (see `project_budgets.mode`), the effective execution mode is temporarily downgraded to `scrapper` for that project regardless of the user's stored preference.

Database schema changes are managed through Drizzle Kit migrations. The `drizzle/migrations` directory contains SQL files representing these changes, ensuring that the database schema can be evolved systematically and reliably.
