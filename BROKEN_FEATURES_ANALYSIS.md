# Omnecor End-User Facing Issues - Comprehensive Analysis

## Executive Summary

Analysis of the Omnecor codebase reveals **~15 critical end-user facing issues** across three categories:
- **10 dead buttons** (UI elements with no onClick handlers)
- **3 major features with mock/placeholder data** (not functional)
- **2-3 incomplete handlers** (buttons that appear functional but do nothing)

---

## 1. DEAD UI BUTTONS (Buttons with No onClick Handlers)

### 1.1 Integration Management

#### Issue #1: IntegrationsHub Settings Button
- **File**: [client/src/components/IntegrationsHub.tsx](client/src/components/IntegrationsHub.tsx#L318)
- **Component**: Settings button in integration card
- **Code**:
  ```jsx
  <Button size="sm" variant="outline" className="flex-1" aria-label={`${info.title} settings`}>
    <Settings className="w-3 h-3 mr-1" aria-hidden="true" />
    Settings
  </Button>
  ```
- **Issue**: No `onClick` handler defined
- **User Impact**: Clicking Settings button does nothing. Users cannot configure integration-specific settings.
- **Fix**: Add `onClick={() => handleOpenSettings(integration.id)}` and implement settings modal

#### Issue #2: IntegrationsHub Connect Account Button
- **File**: [client/src/components/IntegrationsHub.tsx](client/src/components/IntegrationsHub.tsx#L334)
- **Component**: Connect Account button for disconnected integrations
- **Code**:
  ```jsx
  <Button size="sm" className="w-full" aria-label={`Connect ${info.title} account`}>
    <Link2 className="w-3 h-3 mr-2" aria-hidden="true" />
    Connect Account
  </Button>
  ```
- **Issue**: No `onClick` handler; no OAuth flow implemented
- **User Impact**: Users cannot establish new OAuth connections to GitHub, Notion, Slack, or Google Drive
- **Fix**: Add `onClick={() => initiateOAuthFlow(integration.type)}` and implement OAuth flow handlers

---

### 1.2 Knowledge Management

#### Issue #3: DocumentLibrary ExternalLink Button
- **File**: [client/src/components/knowledge/DocumentLibrary.tsx](client/src/components/knowledge/DocumentLibrary.tsx#L70)
- **Component**: ExternalLink icon button in search results table
- **Code**:
  ```jsx
  <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100">
    <ExternalLink className="w-3.5 h-3.5" />
  </Button>
  ```
- **Issue**: No `onClick` handler defined
- **User Impact**: Users cannot navigate to or preview documents from knowledge base search results
- **Fix**: Add `onClick={() => openDocument(res.id)}` to navigate to document or open preview

---

### 1.3 Neural Brain Map / Workspace

#### Issue #4: NeuralWorkspaceCanvas Search Button
- **File**: [client/src/components/workspace/NeuralWorkspaceCanvas.tsx](client/src/components/workspace/NeuralWorkspaceCanvas.tsx#L99)
- **Component**: Search toolbar button in neural workspace
- **Code**:
  ```jsx
  <Button variant="ghost" size="icon" className="h-8 w-8">
    <Search className="w-4 h-4" />
  </Button>
  ```
- **Issue**: No `onClick` handler; no search functionality implemented
- **User Impact**: Workspace search is non-functional, users cannot filter nodes by name/path
- **Fix**: Add `onClick={() => setSearchOpen(true)}` and implement search modal

#### Issue #5: NeuralWorkspaceCanvas Add Node Button
- **File**: [client/src/components/workspace/NeuralWorkspaceCanvas.tsx](client/src/components/workspace/NeuralWorkspaceCanvas.tsx#L100)
- **Component**: Plus icon button to add new nodes
- **Code**:
  ```jsx
  <Button variant="ghost" size="icon" className="h-8 w-8">
    <Plus className="w-4 h-4" />
  </Button>
  ```
- **Issue**: No `onClick` handler; workspace is read-only
- **User Impact**: Users cannot add new nodes to their workspace graph visualization
- **Fix**: Add `onClick={() => openAddNodeDialog()}` to show node creation dialog

#### Issue #6: NeuralWorkspaceCanvas Download Button
- **File**: [client/src/components/workspace/NeuralWorkspaceCanvas.tsx](client/src/components/workspace/NeuralWorkspaceCanvas.tsx#L103)
- **Component**: Download icon button to export workspace
- **Code**:
  ```jsx
  <Button variant="ghost" size="icon" className="h-8 w-8">
    <Download className="w-4 h-4" />
  </Button>
  ```
- **Issue**: No `onClick` handler; export functionality not implemented
- **User Impact**: Users cannot export or save their workspace state
- **Fix**: Add `onClick={() => downloadWorkspace()}` to export workspace as JSON/image

---

### 1.4 Image Generation

#### Issue #7: ComfyPanel Refresh Button
- **File**: [client/src/components/media/ComfyPanel.tsx](client/src/components/media/ComfyPanel.tsx#L65)
- **Component**: Refresh button in ComfyUI Active Queue panel
- **Code**:
  ```jsx
  <Button variant="ghost" size="icon" className="h-8 w-8">
    <RefreshCw className="w-3 h-3" />
  </Button>
  ```
- **Issue**: No `onClick` handler; manual refresh not implemented
- **User Impact**: Users cannot manually refresh the ComfyUI job queue display (only auto-refreshes on interval)
- **Fix**: Add `onClick={() => statusQuery.refetch()}` to manually refresh queue

---

### 1.5 Settings & Configuration

#### Issue #8: Settings Hardware Detection Button
- **File**: [client/src/pages/Settings.tsx](client/src/pages/Settings.tsx#L145)
- **Component**: "Detect Hardware" button in Hardware tab
- **Code**:
  ```jsx
  <Button variant="outline">Detect Hardware</Button>
  ```
- **Issue**: No `onClick` handler; auto-detection not implemented
- **User Impact**: Users cannot auto-detect KiCad paths, Blender installation, GPU info, etc.
- **Fix**: Add `onClick={() => detectHardwareMutation.mutate()}` and implement backend detection

---

### 1.6 Model Management

#### Issue #9: ModelHub Add Provider Button
- **File**: [client/src/pages/ModelHub.tsx](client/src/pages/ModelHub.tsx#L112)
- **Component**: "Add Provider" button in Model Hub header
- **Code**:
  ```jsx
  <Button size="sm">
    <Plus className="w-4 h-4 mr-2" />
    Add Provider
  </Button>
  ```
- **Issue**: No `onClick` handler; provider management not implemented
- **User Impact**: Users cannot add new AI model providers (must manually edit config)
- **Fix**: Add `onClick={() => setShowAddProviderDialog(true)}` and implement provider dialog

#### Issue #10: ModelHub Use This Model Button
- **File**: [client/src/pages/ModelHub.tsx](client/src/pages/ModelHub.tsx#L188)
- **Component**: "Use This Model" button in model details panel
- **Code**:
  ```jsx
  <Button className="w-full mt-4" size="sm">
    Use This Model
  </Button>
  ```
- **Issue**: No `onClick` handler; model selection not functional
- **User Impact**: UI suggests users can select a model but button does nothing
- **Fix**: Add `onClick={() => selectModelMutation.mutate(selectedModel)}` to activate model

---

## 2. BROKEN FEATURES - MOCK/PLACEHOLDER DATA

### 2.1 OAuth Integrations Use Only Mock Data

**Severity**: CRITICAL - Core feature non-functional

#### GitHub Integration
- **File**: [client/src/components/IntegrationsHub.tsx](client/src/components/IntegrationsHub.tsx#L52)
- **File**: [client/src/lib/integrations.ts](client/src/lib/integrations.ts#L342)
- **Issue**: Component initializes with `createMockGitHubIntegration()`
- **Fake Data**:
  - Username: "omnecor-user"
  - Repositories shown: "omnecor.ai-workstation", "neural-map-visualizer"
  - All generated with fake tokens and random data
- **User Impact**: 
  - No real GitHub OAuth connection
  - Repositories don't sync
  - No code integration features work
  - Users see placeholder data, not their actual repos

#### Notion Integration
- **File**: [client/src/lib/integrations.ts](client/src/lib/integrations.ts#L390)
- **Issue**: Component initializes with `createMockNotionIntegration()`
- **Fake Data**:
  - Username: "omnecor-user"
  - Databases shown: "Team Wiki" (12 items), "Research Findings" (45 items)
  - Random fake access tokens
- **User Impact**:
  - No real Notion workspace access
  - Knowledge base won't actually sync Notion docs
  - Display shows mock data, not user's actual Notion

#### Slack Integration
- **File**: [client/src/lib/integrations.ts](client/src/lib/integrations.ts#L432)
- **Issue**: Component initializes with `createMockSlackIntegration()`
- **Fake Data**:
  - Username: "omnecor-bot"
  - Workspace shown: "Omnecor Team" with channels: general, ai-research, private-notes
  - Random fake tokens
- **User Impact**:
  - No real Slack workspace connection
  - Cannot send/receive messages via integration
  - Display shows fake team data

#### Google Drive Integration
- **File**: [client/src/lib/integrations.ts](client/src/lib/integrations.ts#L472)
- **Issue**: Component initializes with `createMockGoogleDriveIntegration()`
- **Fake Data**:
  - Email: "omnecor.user@gmail.com"
  - Storage shown: 15GB used / 100GB total (hardcoded)
  - Fake access and refresh tokens
- **User Impact**:
  - No real Google Drive connection
  - Files don't sync
  - Storage quota is fake

---

### 2.2 Model Marketplace Uses Mock Data

**Severity**: HIGH - Marketplace feature non-functional

- **File**: [client/src/components/ModelHubPanel.tsx](client/src/components/ModelHubPanel.tsx#L33)
- **File**: [client/src/lib/aiModels.ts](client/src/lib/aiModels.ts#L100)
- **Issue**: Model search returns `mockMarketplaceModels`

**Mock Models**:
```
- Mistral 7B (150,000 fake downloads, 4.8★)
- Llama 2 13B (200,000 fake downloads, 4.7★)
- Neural Chat 7B (80,000 fake downloads, 4.5★)
- Phi 2 (120,000 fake downloads, 4.6★)
```

- **User Impact**:
  - Marketplace appears functional but all data is fake
  - Users see high download counts that don't represent real usage
  - Clicking "Download" does nothing (see Issue #11 below)

---

### 2.3 Specialized Modules Use Mock Sessions

**Severity**: MEDIUM - Advanced features non-functional

- **File**: [client/src/components/SpecializedModuleLauncher.tsx](client/src/components/SpecializedModuleLauncher.tsx#L33)
- **File**: [client/src/lib/specializedModules.ts](client/src/lib/specializedModules.ts)
- **Issue**: Three specialized modules initialize with mock data:

1. **LLM Builder** - `createMockLLMBuilderSession()`
   - Fake fine-tuning dataset
   - Mock training metrics
   
2. **Blender Co-Pilot** - `createMockBlenderProject()`
   - No real Blender integration
   - Mock 3D project data
   
3. **PCB Designer Co-Pilot** - `createMockPCBProject()`
   - No real KiCad integration
   - Mock schematic/PCB data

- **User Impact**:
  - UI shows these features but they don't function
  - No real training runs
  - No Blender/KiCad integration works

---

## 3. INCOMPLETE/PARTIALLY IMPLEMENTED FEATURES

### 3.1 Integration Sync is Simulated Only

**Severity**: HIGH - Core feature non-functional

- **File**: [client/src/components/IntegrationsHub.tsx](client/src/components/IntegrationsHub.tsx#L74)
- **Issue**: Sync button only simulates with `setTimeout()`:

```javascript
const handleSync = (integrationId: string) => {
  setConnectedIntegrations(
    connectedIntegrations.map(int =>
      int.id === integrationId
        ? { ...int, syncStatus: "syncing" as const }
        : int
    )
  );

  // Simulate sync completion - NO ACTUAL SYNC CALL
  setTimeout(() => {
    setConnectedIntegrations(prev =>
      prev.map(int =>
        int.id === integrationId
          ? { ...int, syncStatus: "success" as const, lastSynced: new Date() }
          : int
      )
    );
  }, 2000);
};
```

- **User Impact**:
  - UI shows "Syncing..." then "Sync successful"
  - Nothing actually synced
  - No backend API call made
  - Mock data remains unchanged

- **Fix**: Replace `setTimeout()` with actual `trpc.integrations.sync.useMutation()` call

---

### 3.2 Model Download Handler Does Nothing

**Severity**: HIGH - Download feature non-functional

- **File**: [client/src/pages/ModelHub.tsx](client/src/pages/ModelHub.tsx#L55)
- **Issue**: Download handler only logs to console:

```javascript
const handleModelDownload = (item: ModelMarketplaceItem) => {
  console.log("Downloading model:", item.name);  // No actual download logic!
};
```

- **User Impact**:
  - Clicking download shows console log
  - Model is never actually pulled/downloaded
  - No progress indication

- **Fix**: Implement actual model download:
  ```javascript
  const handleModelDownload = (item: ModelMarketplaceItem) => {
    pullMutation.mutate({ name: item.id });
  };
  ```

---

### 3.3 Neural Workspace is Read-Only

**Severity**: MEDIUM - Visualization feature limited

- **File**: [client/src/components/workspace/NeuralWorkspaceCanvas.tsx](client/src/components/workspace/NeuralWorkspaceCanvas.tsx#L95)
- **Issue**: Four toolbar buttons have no handlers:
  - Search (line 99) - no search
  - Plus (line 100) - can't add nodes
  - Download (line 103) - can't export
  - Refresh (line 65 in ComfyPanel) - only auto-refreshes

- **User Impact**:
  - Users can only view workspace
  - Cannot interact or modify
  - Cannot export work

---

### 3.4 Integration Settings Modal Missing

**Severity**: MEDIUM - Settings feature incomplete

- **File**: [client/src/components/IntegrationsHub.tsx](client/src/components/IntegrationsHub.tsx#L318)
- **Issue**: Settings button renders but no modal/dialog implementation

- **User Impact**:
  - Users can't configure sync settings
  - Can't choose what to sync
  - No granular control over integrations

---

## 4. API ENDPOINT VERIFICATION

### Verified Working Endpoints ✓

The following tRPC endpoints exist and are properly implemented in [server/routers.ts](server/routers.ts):

- `knowledgeBase.ensureProject` ✓
- `knowledgeBase.search` ✓
- `knowledgeBase.ingestDirectory` ✓
- `pipeline.createPipeline` ✓
- `pipeline.getPipeline` ✓
- `pipeline.approvePhase` ✓
- `pipeline.abortPipeline` ✓
- `imageGen.providers` ✓
- `imageGen.generate` ✓
- `mcp.connectServer` ✓
- `mcp.disconnectServer` ✓
- `mcp.callTool` ✓
- `mcp.listTools` ✓
- `ollama.listModels` ✓
- `ollama.pullModel` ✓
- `ollama.deleteModel` ✓

### Potentially Missing Implementations

- `integrations.connect` - OAuth flow not implemented
- `integrations.sync` - No backend sync logic
- `integrations.getSettings` - No settings API
- `workspace.addNode` - No workspace modification API
- `workspace.downloadWorkspace` - No export API
- `hardware.detectHardware` - No detection implemented

---

## RECOMMENDATIONS

### Immediate Fixes (Priority 1)

1. **Add onClick handlers to all dead buttons** (Issues #1-10)
   - 10 missing handlers across UI
   - Expected effort: 2-4 hours
   - Test: Click each button, verify handler fires and updates UI

2. **Implement OAuth integration flows**
   - GitHub, Notion, Slack, Google Drive
   - Remove mock data initialization
   - Expected effort: 8-16 hours
   - Test: Connect each service, verify real data loads

3. **Implement integration sync backend**
   - Replace `setTimeout()` simulation with actual `trpc.integrations.sync` mutation
   - Expected effort: 4-8 hours

### Medium Priority (Priority 2)

4. **Add model download functionality** (Issue #11)
   - Connect "Download" button to `ollama.pullModel` endpoint
   - Expected effort: 2-4 hours

5. **Implement workspace interaction** (Issues #4-6)
   - Add node creation dialog
   - Add search functionality
   - Add export functionality
   - Expected effort: 8-12 hours

### Lower Priority (Priority 3)

6. **Remove mock data from specialized modules**
   - LLM Builder, Blender, PCB Designer
   - Implement proper backend connections
   - Expected effort: 16+ hours

7. **Implement hardware detection**
   - Auto-detect Blender, KiCad, GPU
   - Expected effort: 4-8 hours

---

## Summary Table

| Issue | Type | File | Severity | Fix Effort |
|-------|------|------|----------|-----------|
| #1-2 | Dead Button | IntegrationsHub.tsx | CRITICAL | 1 hour |
| #3 | Dead Button | DocumentLibrary.tsx | HIGH | 0.5 hour |
| #4-6 | Dead Button | NeuralWorkspaceCanvas.tsx | HIGH | 2 hours |
| #7 | Dead Button | ComfyPanel.tsx | MEDIUM | 0.5 hour |
| #8 | Dead Button | Settings.tsx | MEDIUM | 1 hour |
| #9-10 | Dead Button | ModelHub.tsx | HIGH | 1 hour |
| #11 | Mock Data | IntegrationsHub.tsx | CRITICAL | 12 hours |
| #12 | Mock Data | ModelHubPanel.tsx | HIGH | 6 hours |
| #13 | Incomplete | IntegrationsHub.tsx | HIGH | 8 hours |
| #14 | Incomplete | ModelHub.tsx | HIGH | 2 hours |
| #15 | Incomplete | NeuralWorkspaceCanvas.tsx | MEDIUM | 8 hours |

**Total Estimated Fix Time**: ~45-55 hours

