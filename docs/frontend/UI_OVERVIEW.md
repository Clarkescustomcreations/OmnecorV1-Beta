# Omnecor User Interface Overview

Omnecor's user interface (UI) is designed for clarity, efficiency, and an intuitive user experience, built with modern web technologies like React, Vite, and shadcn/ui. This document provides a high-level overview of the main UI components and their general layout.

## 1. Overall Layout Philosophy

The Omnecor UI adopts a flexible, workspace-centric design, allowing users to manage multiple projects and AI interactions simultaneously. The layout is responsive and aims to provide a consistent experience across different screen sizes, though it is primarily optimized for desktop use.

## 2. Key UI Regions

### 2.1. Navigation Sidebar

Located on the left side of the application, the **Navigation Sidebar** provides global access to core Omnecor functionalities and modules.

-   **Purpose**: Global navigation, quick access to main sections, and session management.
-   **Contents**: Icons and labels for sections such as Dashboard, Chat, Model Hub, Neural Brain Map, Pipelines, Integrations, and Settings.
-   **Interaction**: Clickable icons/labels to switch between main views. May include collapsible sections for sub-features.

### 2.2. Header

The **Header** spans the top of the application, offering quick access to common actions and system status indicators.

-   **Purpose**: Application-wide controls, notifications, and user profile access.
-   **Contents**: Application logo, search bar (Command Palette trigger), notifications, user avatar/profile, and potentially system status indicators (e.g., OMMESH connection status).
-   **Interaction**: Clickable elements for opening menus, triggering searches, or accessing user-specific settings.

### 2.3. Main Content Area (Workspaces)

The central and largest part of the UI is the **Main Content Area**, which dynamically changes based on the selected module from the Navigation Sidebar. This area is designed to host various workspaces and panels.

-   **Purpose**: Displaying the primary content and interactive elements of the currently active module.
-   **Examples**:
    -   **Dashboard**: Overview of active projects, system status, and recent activities.
    -   **Chat Interface**: Conversational AI interface with streaming responses.
    -   **Neural Workspaces (Neural Brain Map)**: An interactive canvas where users visualize and manage projects as spatial graphs.
    -   **Model Hub**: Interface for managing local and cloud AI models.
    -   **Pipelines**: Workflow orchestration and management interface.
    -   **Settings**: Configuration options for the entire application.

### 2.4. Panels and Floating Windows

Omnecor supports a flexible panel system, allowing users to arrange and customize their workspace. This includes both fixed panels within the main content area and detachable floating windows.

-   **Purpose**: Providing modular views and tools that can be arranged to suit user preferences and workflows.
-   **Examples**: Code editors, terminal outputs, media viewers, specific AI agent controls.
-   **Interaction**: Panels can often be resized, docked, undocked, or minimized. Floating windows can be moved freely across the screen, including multi-monitor setups.

## 3. Key UI Elements and Interactions

### 3.1. Buttons and Input Fields

Standard UI controls are used throughout, adhering to the shadcn/ui design system for consistency and accessibility.

### 3.2. Context Menus and Dropdowns

Right-click context menus and dropdowns provide quick access to relevant actions based on the selected element or context.

### 3.3. Notifications (Sonner)

System notifications are handled by `sonner`, providing clear and non-intrusive feedback to the user about background processes, task completions, or errors.

### 3.4. Modals and Dialogs

Used for critical user confirmations, detailed configuration forms, or displaying supplementary information that requires user attention.

### 3.5. Keyboard Shortcuts (KBD)

Omnecor supports a range of keyboard shortcuts for efficient navigation and interaction, enhancing productivity for power users. These are documented in the `keyboardShortcuts.ts` file.

## 4. Responsive Behavior

While optimized for larger screens, Omnecor components are designed with responsiveness in mind. Elements may adapt their layout or hide less critical information on smaller viewports. The `useMobile.tsx` hook helps in adapting UI behavior for mobile contexts, though the primary target is desktop workstations.

## 5. Theming

Omnecor supports theming, allowing users to customize the visual appearance. The default theme adheres to the Omnecor brand guidelines, featuring a dark slate background with amber accents.
