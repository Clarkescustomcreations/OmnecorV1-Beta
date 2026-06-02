# 🔴 END-USER FACING ISSUES - OMNECOR

**Critical Feature Breakdowns That Impact Users Immediately**

Generated: June 2, 2026  
Scope: UI buttons, missing features, broken functionality  
Total Issues: 15

---

## 🔴 CRITICAL ISSUES (Users Cannot Use These Features)

### 1. **OAuth Integrations Are Non-Functional** 
**Status:** 🔴 BROKEN - Uses Mock Data

**Affected Features:**
- GitHub Integration (repositories don't sync)
- Notion Integration (knowledge base won't sync Notion)
- Slack Integration (no messaging capability)
- Google Drive Integration (files don't sync)

**Problem:**
```javascript
// IntegrationsHub.tsx - Uses fake data
const mockGitHubIntegration = createMockGitHubIntegration();
const mockNotionIntegration = createMockNotionIntegration();
const mockSlackIntegration = createMockSlackIntegration();
const mockGoogleDriveIntegration = createMockGoogleDriveIntegration();

// Users see:
// ✗ "omnecor-user" instead of their username
// ✗ Fake repo "omnecor.ai-workstation" instead of their repos
// ✗ 150,000 fake downloads on models
// ✗ 4.8★ rating that isn't real
```

**Impact:**
- Users click "Connect Account" → nothing happens
- OAuth flow is completely missing
- No real data syncs from any integration
- Settings button has no handler (dead button)

**User Experience:**
```
User tries to connect GitHub → Clicks "Connect Account" → Nothing happens
User tries to sync GitHub → Clicks "Sync" → Fake "sync complete" animation
```

**Files Involved:**
- `client/src/components/IntegrationsHub.tsx:318` - Settings button with no onClick
- `client/src/components/IntegrationsHub.tsx:334` - Connect button with no onClick
- `client/src/lib/integrations.ts` - Mock data initialization
- `server/routers/` - No OAuth endpoint implementations

**Estimated Fix:** 12-16 hours

**Fix Required:**
1. Implement OAuth endpoints for each provider
2. Remove mock data initialization
3. Add onClick handlers
4. Implement real token storage

---

### 2. **Model Download Does Nothing**
**Status:** 🔴 BROKEN - Handler Only Logs

**Problem:**
```javascript
// ModelHub.tsx:55 - Download handler is a stub
const handleModelDownload = (item: ModelMarketplaceItem) => {
  console.log("Downloading model:", item.name); // Only logs!
};
```

**Impact:**
- Users click "Download" for any model
- Console logs: "Downloading model: Mistral 7B"
- No model actually downloads
- No progress bar, no error message

**Files Involved:**
- `client/src/pages/ModelHub.tsx:55`
- `client/src/components/ModelHubPanel.tsx:33` - Uses mock model data

**Estimated Fix:** 2-4 hours

**Fix Required:**
- Replace with actual `ollama.pullModel` mutation
- Add progress tracking
- Add error handling

---

### 3. **Integration Sync is Fake**
**Status:** 🔴 BROKEN - Simulated with setTimeout

**Problem:**
```javascript
// IntegrationsHub.tsx:74 - Sync only simulates
const handleSync = (integrationId: string) => {
  // UI shows "Syncing..."
  setConnectedIntegrations(...);
  
  // Wait 2 seconds, then show "Sync successful"
  setTimeout(() => {
    // NO ACTUAL SYNC CALL!
    setConnectedIntegrations(...);
  }, 2000);
};
```

**Impact:**
- Users see "Syncing..." animation
- Users see "Sync successful" message
- Nothing actually synced
- Users believe their data is being synced when it's not

**Files Involved:**
- `client/src/components/IntegrationsHub.tsx:74`

**User Experience (Deceptive):**
```
User clicks GitHub "Sync" → UI shows "Syncing..." → UI shows "Sync successful"
BUT ACTUALLY: No API call made, no data synced, no repos pulled
```

**Estimated Fix:** 4-8 hours

**Fix Required:**
- Replace setTimeout with real tRPC mutation
- Implement `integrations.sync` backend endpoint

---

## 🟡 HIGH PRIORITY ISSUES (Broken Buttons)

### 4. **Settings Button Does Nothing (Integrations)**
**File:** `client/src/components/IntegrationsHub.tsx:318`  
**Impact:** Users can't configure integration settings

```jsx
// Dead button - no onClick handler
<Button size="sm" variant="outline" className="flex-1" aria-label={`${info.title} settings`}>
  <Settings className="w-3 h-3 mr-1" aria-hidden="true" />
  Settings
</Button>
```

**Fix:** Add `onClick={() => openSettingsDialog(integration.id)}`

**Estimated Fix:** 1 hour

---

### 5. **Connect Account Button Does Nothing**
**File:** `client/src/components/IntegrationsHub.tsx:334`  
**Impact:** Users can't establish OAuth connections

```jsx
// Dead button - no onClick handler, no OAuth flow
<Button size="sm" className="w-full" aria-label={`Connect ${info.title} account`}>
  <Link2 className="w-3 h-3 mr-2" aria-hidden="true" />
  Connect Account
</Button>
```

**Fix:** Add `onClick={() => startOAuthFlow(integration.type)}`

**Estimated Fix:** 1 hour

---

### 6. **Knowledge Base Document Link Does Nothing**
**File:** `client/src/components/knowledge/DocumentLibrary.tsx:70`  
**Impact:** Users can't view/open documents from search results

```jsx
// Dead button - no onClick handler
<Button variant="ghost" size="icon" className="h-8 w-8">
  <ExternalLink className="w-3.5 h-3.5" />
</Button>
```

**Fix:** Add `onClick={() => openDocument(result.id)}`

**Estimated Fix:** 0.5 hour

---

### 7. **Add Provider Button Does Nothing**
**File:** `client/src/pages/ModelHub.tsx:112`  
**Impact:** Users can't add new AI providers

```jsx
// Dead button - no onClick handler
<Button size="sm">
  <Plus className="w-4 h-4 mr-2" />
  Add Provider
</Button>
```

**Fix:** Add `onClick={() => setShowAddProviderDialog(true)}`

**Estimated Fix:** 1 hour

---

### 8. **Use This Model Button Does Nothing**
**File:** `client/src/pages/ModelHub.tsx:188`  
**Impact:** Users can't select models from marketplace

```jsx
// Dead button - no onClick handler
<Button className="w-full mt-4" size="sm">
  Use This Model
</Button>
```

**Fix:** Add `onClick={() => selectModelMutation.mutate(selectedModel)}`

**Estimated Fix:** 1 hour

---

### 9. **Workspace Search Button Does Nothing**
**File:** `client/src/components/workspace/NeuralWorkspaceCanvas.tsx:99`  
**Impact:** Users can't search/filter nodes in workspace

```jsx
// Dead button - no onClick handler
<Button variant="ghost" size="icon" className="h-8 w-8">
  <Search className="w-4 h-4" />
</Button>
```

**Fix:** Add `onClick={() => setSearchOpen(true)}`

**Estimated Fix:** 1 hour

---

### 10. **Workspace Add Node Button Does Nothing**
**File:** `client/src/components/workspace/NeuralWorkspaceCanvas.tsx:100`  
**Impact:** Workspace is read-only, users can't modify it

```jsx
// Dead button - no onClick handler
<Button variant="ghost" size="icon" className="h-8 w-8">
  <Plus className="w-4 h-4" />
</Button>
```

**Fix:** Add `onClick={() => openAddNodeDialog()}`

**Estimated Fix:** 2 hours

---

### 11. **Workspace Download Button Does Nothing**
**File:** `client/src/components/workspace/NeuralWorkspaceCanvas.tsx:103`  
**Impact:** Users can't export/save workspace

```jsx
// Dead button - no onClick handler
<Button variant="ghost" size="icon" className="h-8 w-8">
  <Download className="w-4 h-4" />
</Button>
```

**Fix:** Add `onClick={() => downloadWorkspace()}`

**Estimated Fix:** 1 hour

---

### 12. **ComfyUI Refresh Button Does Nothing**
**File:** `client/src/components/media/ComfyPanel.tsx:65`  
**Impact:** Users can't manually refresh job queue

```jsx
// Dead button - no onClick handler
<Button variant="ghost" size="icon" className="h-8 w-8">
  <RefreshCw className="w-3 h-3" />
</Button>
```

**Fix:** Add `onClick={() => statusQuery.refetch()}`

**Estimated Fix:** 0.5 hour

---

### 13. **Detect Hardware Button Does Nothing**
**File:** `client/src/pages/Settings.tsx:145`  
**Impact:** Users can't auto-detect hardware (GPU, Blender, KiCad)

```jsx
// Dead button - no onClick handler
<Button variant="outline">Detect Hardware</Button>
```

**Fix:** Add `onClick={() => detectHardwareMutation.mutate()}`

**Estimated Fix:** 1 hour

---

## 🟠 MEDIUM PRIORITY ISSUES (Fake Data)

### 14. **Model Marketplace Uses Fake Data**
**Files:**
- `client/src/lib/aiModels.ts:100` - Mock models
- `client/src/components/ModelHubPanel.tsx:33`

**Problem:**
```javascript
// All models are fake with made-up stats
const mockMarketplaceModels = [
  {
    id: "mistral-7b",
    name: "Mistral 7B",
    downloads: 150000,  // FAKE
    rating: 4.8,        // FAKE
    size: "3.5GB",
  },
  // ... more fake models
];
```

**Impact:**
- Users see fake download counts
- Users see fake ratings
- Marketplace appears functional but is placeholder data

**Estimated Fix:** 4-6 hours

**Fix Required:**
- Replace with real model registry API
- Show actual download/usage stats

---

### 15. **Specialized Modules Use Mock Sessions**
**Files:**
- `client/src/components/SpecializedModuleLauncher.tsx`
- `client/src/lib/specializedModules.ts`

**Problem:** Three specialized modules show mock data:
- LLM Builder - Fake training runs
- Blender Co-Pilot - No real Blender integration
- PCB Designer - No real KiCad integration

**Impact:**
- UI shows these features but they don't work
- No real training possible
- No 3D/PCB integration

**Estimated Fix:** 8-12 hours

---

## 📋 SUMMARY TABLE

| # | Issue | Type | Severity | File | Fix Time |
|---|-------|------|----------|------|----------|
| 1 | OAuth integrations mock | Broken | CRITICAL | IntegrationsHub.tsx | 12-16h |
| 2 | Model download stub | Broken | CRITICAL | ModelHub.tsx | 2-4h |
| 3 | Integration sync fake | Broken | CRITICAL | IntegrationsHub.tsx | 4-8h |
| 4 | Settings button dead | Button | HIGH | IntegrationsHub.tsx | 1h |
| 5 | Connect button dead | Button | HIGH | IntegrationsHub.tsx | 1h |
| 6 | Document link dead | Button | HIGH | DocumentLibrary.tsx | 0.5h |
| 7 | Add provider dead | Button | HIGH | ModelHub.tsx | 1h |
| 8 | Use model dead | Button | HIGH | ModelHub.tsx | 1h |
| 9 | Search dead | Button | HIGH | NeuralWorkspaceCanvas.tsx | 1h |
| 10 | Add node dead | Button | HIGH | NeuralWorkspaceCanvas.tsx | 2h |
| 11 | Download dead | Button | HIGH | NeuralWorkspaceCanvas.tsx | 1h |
| 12 | ComfyUI refresh dead | Button | MEDIUM | ComfyPanel.tsx | 0.5h |
| 13 | Detect hardware dead | Button | MEDIUM | Settings.tsx | 1h |
| 14 | Model marketplace fake | Fake Data | MEDIUM | ModelHubPanel.tsx | 4-6h |
| 15 | Specialized modules fake | Fake Data | MEDIUM | SpecializedModuleLauncher.tsx | 8-12h |

**Total Fix Time: 45-55 hours**

---

## 🎯 RECOMMENDED FIX ORDER

### Phase 1 (Week 1) - CRITICAL: 18-28 hours
1. ✗ OAuth integrations (remove mock, implement real)
2. ✗ Model download (connect button to API)
3. ✗ Integration sync (replace setTimeout with real API)

### Phase 2 (Week 1-2) - HIGH: 12-15 hours
4. ✓ Add 10 missing onClick handlers (buttons #4-13)
5. ✓ Test each button works

### Phase 3 (Week 2-3) - MEDIUM: 12-17 hours
6. ✓ Remove fake model data
7. ✓ Remove fake specialized module data

---

## ✅ WORKING FEATURES (For Reference)

The following features work correctly:
- ✅ Chat interface and message history
- ✅ Knowledge base search (when documents are ingested)
- ✅ tRPC API communication
- ✅ User authentication
- ✅ Audit logging
- ✅ Basic settings pages
- ✅ Pipeline creation

---

## 🚀 NEXT STEPS

1. **Prioritize Phase 1 fixes** - Users cannot use critical features
2. **Add integration tests** - Verify buttons fire handlers
3. **Implement OAuth flow** - Real GitHub/Notion/Slack connection
4. **Replace mock data** - Use actual APIs instead of hardcoded data
5. **User testing** - Have real users test each fixed feature
