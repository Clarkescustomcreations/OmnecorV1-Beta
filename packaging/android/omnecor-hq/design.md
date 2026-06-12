# Omnecor Mobile App Design

## Overview

Omnecor Mobile is a simplified, mobile-optimized remote control interface for the main Omnecor desktop application. It functions as a companion app for on-the-go access to core features while maintaining a clean, one-handed-friendly design for portrait orientation.

## Screen List

The app uses a tab-based navigation structure with the following primary screens:

1. **Chat** — Conversational AI interface with chat history, neural map selection, and agent/persona selection
2. **Podcast** — Podcast creation and generation interface
3. **Terminal** — Dedicated terminal/CLI with mobile-specific controls (not sandboxed)
4. **3D Viewer** — Visual inspection of 3D models and PCBs with AI-powered modifications
5. **Status** — Real-time monitoring of running tasks and system status
6. **HITL** — Human-in-the-Loop alerts and approval panel
7. **Settings** — SSH authentication, OMMESH network configuration, user preferences, theme switching

## Primary Content and Functionality

### Chat Screen

**Layout:**
- Top: Chat history selector (dropdown or list)
- Middle: Neural map selector (dropdown or list)
- Middle: Agent/Persona selector (dropdown or list)
- Main content area: Message thread with streaming responses
- Bottom: Message input with file/photo picker buttons
- Right sidebar: Context transparency panel (token usage, files in context)

**Functionality:**
- Display chat messages with streaming support
- Select different chat sessions
- Switch between neural maps
- Choose agent/persona for conversation
- Upload files and photos from device
- Real-time token usage display

### Podcast Screen

**Layout:**
- Top: Podcast title and description input
- Middle: Script/content editor
- Bottom: Generation controls (voice selection, duration, quality)
- Status indicator: Generation progress

**Functionality:**
- Create new podcast episodes
- Edit podcast metadata
- Generate audio from text
- Select voice and generation parameters
- Preview and download generated podcast

### Terminal Screen

**Layout:**
- Main area: Terminal output display (scrollable)
- Bottom: Command input with autocomplete
- Mobile controls: Keyboard toggle, clear, history

**Functionality:**
- Execute terminal commands via SSH to desktop
- Display command output with syntax highlighting
- Command history navigation
- Copy/paste support
- Mobile-specific keyboard controls (not sandboxed)

### 3D Viewer Screen

**Layout:**
- Main area: 3D model/PCB visualization (Three.js or Babylon.js)
- Top: View mode selector (3D View, Schematic/PCB, Code)
- Bottom: AI interaction panel (ask AI about model, modify)
- Right panel: Model properties and selection

**Functionality:**
- Load and display 3D models
- Rotate, zoom, pan with touch gestures
- Switch between 3D and schematic views
- AI-powered model inspection and modification
- Visual selection of model components

### Status Screen

**Layout:**
- Top: Overall system status indicator
- Main area: Scrollable list of running tasks
- Each task item: Task name, progress bar, status badge, ETA
- Bottom: Refresh button and status summary

**Functionality:**
- Display all running tasks with real-time updates
- Show progress bars and status indicators
- Filter tasks by status (running, completed, failed)
- Cancel or pause tasks
- View task logs and details

### HITL Screen

**Layout:**
- Main area: Scrollable list of alerts and approvals
- Each alert item: Alert type, description, action buttons (approve/reject)
- Top: Filter by alert type
- Status: Unread count

**Functionality:**
- Display pending approvals and alerts
- Show alert details and context
- Approve or reject actions
- Mark alerts as read
- Filter by alert type

### Settings Screen

**Layout:**
- Sections: Connection, User Preferences, Appearance, Advanced
- Connection section: SSH host, port, username, password/key
- User preferences: User identity, execution mode
- Appearance: Light/dark mode toggle
- Advanced: OMMESH network configuration, debug options

**Functionality:**
- Configure SSH connection to desktop
- Test connection
- Save connection credentials securely
- Switch between light and dark themes
- Configure OMMESH network
- Manage user identity and preferences

## Key User Flows

### Chat Flow
1. User opens Chat screen
2. Selects or creates a chat session
3. Selects neural map and agent/persona
4. Types message or uploads file/photo
5. AI responds with streaming text
6. User can continue conversation or switch context

### Podcast Creation Flow
1. User opens Podcast screen
2. Enters podcast title and description
3. Writes or pastes script content
4. Selects voice and generation parameters
5. Clicks "Generate"
6. Monitors generation progress
7. Previews and downloads generated podcast

### Terminal Flow
1. User opens Terminal screen
2. Types command in input field
3. Command executes via SSH to desktop
4. Output displays in terminal
5. User can navigate history or clear terminal

### 3D Viewer Flow
1. User opens 3D Viewer screen
2. Loads a 3D model or PCB file
3. Rotates, zooms, and pans with touch
4. Selects components for inspection
5. Asks AI about selected component
6. AI provides analysis or modification suggestions

### Status Monitoring Flow
1. User opens Status screen
2. Views list of running tasks
3. Monitors progress in real-time
4. Filters by status if needed
5. Cancels or pauses tasks as needed

### HITL Approval Flow
1. User opens HITL screen
2. Reviews pending approvals
3. Reads alert details
4. Approves or rejects action
5. Continues monitoring for new alerts

### Connection Setup Flow
1. User opens Settings screen
2. Enters SSH host, port, username
3. Enters password or uploads SSH key
4. Clicks "Test Connection"
5. Confirms successful connection
6. Saves credentials securely

## Color Choices

**Brand Colors:**
- Primary: `#0a7ea4` (Omnecor Blue) — Used for buttons, active states, highlights
- Success: `#22C55E` (Green) — Task completion, approval states
- Warning: `#F59E0B` (Amber) — Pending actions, alerts
- Error: `#EF4444` (Red) — Failed tasks, errors
- Muted: `#687076` (Gray) — Secondary text, disabled states

**Light Mode:**
- Background: `#ffffff` (White)
- Surface: `#f5f5f5` (Light Gray)
- Foreground: `#11181C` (Dark Gray)
- Border: `#E5E7EB` (Light Border)

**Dark Mode:**
- Background: `#151718` (Very Dark Gray)
- Surface: `#1e2022` (Dark Gray)
- Foreground: `#ECEDEE` (Light Gray)
- Border: `#334155` (Dark Border)

## Design Principles

1. **One-Handed Usage** — All interactive elements are within thumb reach on a 6-inch screen
2. **Minimal Clutter** — Focus on core functionality, hide advanced options in Settings
3. **Mobile-First** — Touch-friendly buttons (minimum 44pt), readable text sizes
4. **Real-Time Feedback** — Loading states, progress indicators, haptic feedback
5. **Consistent Navigation** — Tab bar at bottom for primary screens, clear back buttons
6. **Accessibility** — High contrast, readable fonts, clear labels
