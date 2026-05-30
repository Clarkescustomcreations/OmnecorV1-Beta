# Omnecor Frontend State Management

Effective state management is crucial for the responsiveness, maintainability, and scalability of a complex application like Omnecor. The frontend leverages a combination of React's built-in state mechanisms, Context API, and Zustand for global state management, alongside tRPC for data synchronization with the backend.

## 1. Overview of State Management Approaches

Omnecor employs a layered approach to state management, choosing the most appropriate tool for each type of state:

-   **Local Component State**: Managed directly within React components using `useState` and `useReducer` for ephemeral or component-specific data.
-   **React Context API**: Used for sharing state that is considered "global" to a subtree of components, such as theme settings or authentication status, without prop-drilling.
-   **Zustand**: A lightweight, fast, and scalable state-management solution for global application state that needs to be accessed by many components across the application.
-   **tRPC with React Query**: Handles server-side data fetching, caching, and synchronization, providing a robust solution for managing asynchronous data.

## 2. Detailed State Management Mechanisms

### 2.1. Local Component State

For state that is only relevant to a single component or a small, isolated part of the UI, React's `useState` and `useReducer` hooks are utilized. This keeps concerns localized and simplifies debugging.

**Examples**:
-   Input field values within a form.
-   Toggle states for UI elements (e.g., a dropdown being open or closed).
-   Temporary loading indicators.

### 2.2. React Context API

The React Context API is used for managing state that needs to be accessible by many components at different nesting levels without explicitly passing props down through every level (prop-drilling).

**Key Contexts in Omnecor** (`client/src/contexts/`):
-   **`ThemeContext.tsx`**: Manages the application's visual theme (e.g., dark mode, light mode).
-   **`NeuralMapContext.tsx`**: Provides state and functions related to the interactive Neural Brain Map, allowing various components to interact with the map's state.
-   **`FictionModeContext.tsx`**: Manages state specific to the Fiction Mode feature.

### 2.3. Zustand for Global State

Zustand is chosen for managing complex global application state due to its simplicity, performance, and flexibility. It provides a straightforward API for creating and consuming stores.

**Key Zustand Stores in Omnecor** (`client/src/lib/stores/`):
-   **`brainMapStore.ts`**: Manages the intricate state of the Neural Brain Map, including node positions, connections, selections, and other interactive elements. This store likely holds the core data model for the visual workspace.

### 2.4. tRPC with React Query for Server State

`@tanstack/react-query` (integrated with tRPC) is the primary mechanism for managing server-side data. It handles data fetching, caching, invalidation, and synchronization, significantly simplifying the management of asynchronous operations.

**Key Benefits**:
-   **Automatic Caching**: Fetched data is automatically cached, reducing redundant network requests.
-   **Background Refetching**: Stale data can be refetched in the background to ensure the UI is always up-to-date.
-   **Error Handling**: Provides standardized mechanisms for handling errors during data fetching.
-   **Loading States**: Simplifies managing loading and success/error states for API calls.
-   **Type Safety**: Leveraging tRPC, all API calls and their data structures are end-to-end type-safe, from backend to frontend.

**Examples**:
-   Fetching a list of available AI models from the `Model Hub`.
-   Retrieving project configurations or user settings.
-   Mutating data (e.g., saving changes to a neural node, triggering a backend process).

## 3. Data Flow and Synchronization

-   **Frontend-Initiated Actions**: User interactions trigger actions that might update local state, dispatch to Zustand stores, or initiate tRPC calls to the backend.
-   **Backend Responses**: tRPC responses update the React Query cache, which in turn re-renders components subscribed to that data. WebSocket messages directly update relevant Zustand stores or React Contexts for real-time UI changes.
-   **Real-time Updates**: The `useOmnecorSocket.ts` hook (`client/src/hooks/`) plays a crucial role in listening to WebSocket events from the backend and dispatching updates to the appropriate frontend state managers, ensuring the UI reflects the latest server-side changes (e.g., progress of a long-running AI task).

This combination of state management tools allows Omnecor to handle a wide range of data types and interaction patterns efficiently, providing a fluid and responsive user experience.
