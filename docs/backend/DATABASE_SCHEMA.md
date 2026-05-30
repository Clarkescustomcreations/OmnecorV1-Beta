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
| `loginMethod` | `varchar(64)` | Method used for user login. | |
| `role` | `enum('user', 'admin')` | User's role within the system. | `NOT NULL`, `DEFAULT 'user'` |
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

## 3. Relationships

-   **`chat_messages` to `chat_sessions`**: A one-to-many relationship where multiple `chat_messages` can belong to a single `chat_session`. The `sessionId` in `chat_messages` is a foreign key referencing `chat_sessions.id`, with `ON DELETE CASCADE` ensuring that messages are deleted when their parent session is removed.

## 4. Migrations

Database schema changes are managed through Drizzle Kit migrations. The `drizzle/migrations` directory contains SQL files representing these changes, ensuring that the database schema can be evolved systematically and reliably.
