# Omnecor Neural Brain Map UI

The Neural Brain Map is a core feature of Omnecor, providing a spatial, interactive, and graph-based visualization for project management and knowledge organization. This document details its user interface, key interactions, and underlying components.

## 1. Overview

The Neural Brain Map transforms traditional file and knowledge management into a dynamic, visual experience. It allows users to represent project assets, ideas, and relationships as nodes and edges on an interactive canvas, facilitating intuitive understanding and manipulation of complex information.

## 2. Key UI Components

### 2.1. Interactive Canvas (`NeuralGraphView.tsx`)

-   **Purpose**: The main display area for the neural graph, powered by React Flow.
-   **Features**:
    -   **Nodes**: Represent individual pieces of information, files, tasks, or concepts. Nodes can be of various types (e.g., `FileNode.tsx`).
    -   **Edges**: Represent relationships or connections between nodes.
    -   **Zoom & Pan**: Standard navigation for exploring large graphs.
    -   **Drag & Drop**: Users can drag and drop files onto the canvas to create new nodes.
    -   **MiniMap**: A small overview map for easy navigation within large graphs.

### 2.2. Node Types (`client/src/components/workspace/nodes/FileNode.tsx`)

Omnecor supports various node types, each with specific visual representations and functionalities.

-   **`FileNode.tsx`**: Represents a file or directory within the project. Displays file name, icon, and potentially a preview or summary.
-   **Custom Nodes**: The architecture allows for the creation of custom node types to represent specific data structures or AI agents.

### 2.3. Map Manager (`MapManager.tsx`)

-   **Purpose**: Manages the state and interactions within the Neural Brain Map, coordinating between the UI and the backend.
-   **Responsibilities**:
    -   Handling user interactions (node creation, deletion, movement, edge drawing).
    -   Synchronizing graph state with the `brainMapStore` (Zustand).
    -   Initiating tRPC calls to the backend for persistent storage of graph changes.

### 2.4. Neural Tree View (`NeuralTreeView.tsx`)

-   **Purpose**: Provides an alternative, hierarchical view of the neural nodes, useful for understanding the structural organization of projects.
-   **Features**: Displays nodes in a tree-like structure, reflecting parent-child relationships or logical groupings.

## 3. User Interactions

### 3.1. Node Creation and Editing

-   **Drag and Drop**: Users can drag files from their file system directly onto the canvas to create new file nodes.
-   **Context Menu**: Right-clicking on the canvas or an existing node brings up a context menu with options to create new nodes, edit node properties, or perform actions related to the selected node.
-   **Node Properties Panel**: Selecting a node opens a sidebar or modal panel where users can view and edit its properties (e.g., title, description, associated AI context).

### 3.2. Edge Creation and Management

-   **Drawing Edges**: Users can draw connections (edges) between nodes to represent relationships. This might involve dragging from a source node handle to a target node handle.
-   **Edge Properties**: Edges can have properties (e.g., type of relationship, weight) that can be edited via a properties panel.

### 3.3. Spatial Organization

-   **Freeform Layout**: Users have the freedom to arrange nodes spatially on the canvas, creating intuitive visual groupings and flows.
-   **Auto-Layout (Planned)**: Future enhancements may include AI-assisted auto-layout features to organize nodes based on semantic relationships or user preferences.

### 3.4. Search and Filtering

-   **Node Search**: Users can search for specific nodes by name, content, or associated metadata.
-   **Filtering**: Options to filter nodes based on type, tags, or other properties.

## 4. Underlying Architecture

### 4.1. Frontend State Management

-   **`brainMapStore.ts` (Zustand)**: The primary client-side store for the Neural Brain Map state, managing node positions, selections, and other interactive elements.
-   **`NeuralMapContext.tsx`**: Provides access to the brain map state and actions to components within the map hierarchy.

### 4.2. Backend Integration

-   **tRPC API**: The frontend communicates with the backend via tRPC procedures (e.g., `projectRouter`) to persist changes to the neural graph, fetch project data, and trigger AI-related actions based on node interactions.
-   **WebSocket Updates**: Real-time updates to the Neural Brain Map (e.g., changes made by AI agents or other users in a collaborative environment) are pushed to the frontend via WebSockets (`neuralMapUpdate` event type).

### 4.3. AI Integration

-   **Semantic Indexing**: When files are added to the map, the `VectorDBService` indexes their content, allowing for semantic search and Retrieval-Augmented Generation (RAG) by AI agents.
-   **Agent Interaction**: AI agents can interact with the Neural Brain Map, creating new nodes, establishing relationships, or updating node content based on their tasks.

## 5. Workspace Persistence

-   **Automatic Saving**: Changes made to the Neural Brain Map are automatically saved to the backend, ensuring that the workspace state is preserved across sessions.
-   **Workspace Management**: Users can create, load, and manage multiple neural workspaces, each representing a different project or area of focus.
