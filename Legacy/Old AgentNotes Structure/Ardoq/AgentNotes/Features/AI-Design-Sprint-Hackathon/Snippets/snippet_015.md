# Snippet 015 - Auto-refresh Sidebar on Save

## Problem
Sidebar didn't update automatically when "Save this action" button was clicked in Chat.

## Solution
Implemented shared state communication between Chat and Sidebar through App component.

### Changes

**1. App.tsx**
- Added `refreshTrigger` state (increments on save)
- Created `triggerRefresh` callback
- Passed `onActionSaved` prop to Chat
- Passed `refreshTrigger` prop to Sidebar

```tsx
const [refreshTrigger, setRefreshTrigger] = useState(0);

const triggerRefresh = () => {
  setRefreshTrigger(prev => prev + 1);
};

<Chat onActionSaved={triggerRefresh} />
<Sidebar refreshTrigger={refreshTrigger} />
```

**2. Chat.tsx**
- Added `ChatProps` interface with `onActionSaved` callback
- Call `onActionSaved()` after successful save

```tsx
const handleSaveAction = async (toolCall: ToolCall) => {
  await saveAction(...);
  alert("Action saved successfully!");
  if (onActionSaved) {
    onActionSaved(); // Trigger refresh
  }
};
```

**3. Sidebar.tsx**
- Added `SidebarProps` interface with `refreshTrigger` prop
- Updated `useEffect` dependency to include `refreshTrigger`

```tsx
useEffect(() => {
  fetchActions();
}, [refreshTrigger]); // Re-fetch when trigger changes
```

## Flow
1. User clicks "Save this action" in Chat
2. Action is saved to backend
3. Chat calls `onActionSaved()` callback
4. App increments `refreshTrigger`
5. Sidebar detects change in `refreshTrigger`
6. Sidebar re-fetches actions from backend
7. New action appears immediately

## Result
Sidebar now auto-updates when actions are saved! ✅
