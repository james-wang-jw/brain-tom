# Top of Mind (TOM) Chat Interface
## Project Specification Document

---

## 1. Project Overview

### 1.1 Core Concept
A web-based AI chat interface similar to ChatGPT/Claude, with an added "Top of Mind" (TOM) marker system that enables semantic navigation across conversations.

### 1.2 Problem Statement
Current AI chat interfaces present conversations as flat chronological lists. Users struggle to navigate to specific points within potentially hundreds of chats. The mental model of "which conversation was this in?" does not match how users actually think about their work.

### 1.3 Solution
TOM markers extract semantic context from conversations, creating navigable "bookmarks" that represent user insights, topic shifts, and conceptual progress. Users navigate by *what they were thinking about*, not *when they talked about it*.

---

## 2. Core Requirements

### 2.1 TOM Marker System

#### 2.1.1 Marker Definition
- A TOM marker is a natural language description of the user's current focus, insight, or thought at a specific point in a conversation
- Markers are created by the AI during chat, not manually by users
- Abbreviation: TOM (Top of Mind)

#### 2.1.2 Marker Generation Rules
The AI should create a marker when:
- User has a new insight or realization
- Conversation shifts to a new topic
- An existing concept or discussion advances significantly

The AI should NOT create a marker:
- For every turn of conversation
- For routine back-and-forth without meaningful progress
- For clarifying questions or simple acknowledgments

#### 2.1.3 Marker Properties
Each marker contains:
- `id`: Unique identifier
- `label`: Natural language description (concise, under 60 characters recommended)
- `timestamp`: Creation time
- `chatId`: Reference to parent conversation
- `messageIndex`: Position in conversation where marker was created

#### 2.1.4 Marker Structure
- All markers are linear (flat list)
- No nested or hierarchical markers
- Markers appear in two locations:
  1. Inline below the AI response that generated them
  2. In the sidebar as a table of contents for the current chat

### 2.2 Home Screen

#### 2.2.1 Purpose
Entry point for all chat interactions. Users enter conversations from here and can return from any chat.

#### 2.2.2 Entry Methods (3 required)

**Method 1: New Chat**
- Creates a brand new conversation with no context
- Simple, prominent button/action

**Method 2: Relevant TOMs**
- System surfaces the most relevant TOM markers across ALL user chats
- Relevance is calculated based on:
  - What the user just chatted about, OR
  - The most recent chat when returning to home screen
- Clicking a marker navigates to that specific point in that specific chat
- User can continue the conversation from that point

**Method 3: Recent TOMs**
- List of most recently created TOM markers
- Sorted by timestamp (newest first)
- Provides familiar "recent activity" pattern
- Clicking navigates to the marker location in its chat

#### 2.2.3 Search Functionality
- Search bar accepting natural language queries
- Returns most relevant TOMs matching the query
- Searches across all chats the user has had
- Example: User types "that pricing discussion" → returns TOMs related to pricing from any conversation

#### 2.2.4 Legacy Chat List
- Traditional recent chats list can exist as secondary navigation
- Goal: Users should use TOM-based navigation at least 50% of the time

### 2.3 Chat Interface

#### 2.3.1 Sidebar
- Displays all TOM markers from the current conversation
- Functions as table of contents / directory
- Clicking a marker scrolls to that point in the conversation
- Collapsible to maximize chat space

#### 2.3.2 Inline Markers
- TOM markers appear below the AI response that generated them
- Visually distinct from message content
- Clickable (scrolls to that position if navigated away)

#### 2.3.3 Navigation
- Home button to return to home screen from any chat
- Smooth scroll animation when navigating to markers
- Visual highlight when landing on a marker location

### 2.4 LLM Integration

#### 2.4.1 API Configuration
```
GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
```

#### 2.4.2 TOM Generation Prompt Strategy
The AI must be instructed to:
1. Provide helpful responses to user queries
2. Evaluate whether the exchange warrants a TOM marker
3. If warranted, append a marker in a parseable format
4. Keep marker labels concise and user-perspective focused

---

## Section 3: UX Recommendations (Updated)

*This section contains design decisions and recommendations that address usability concerns identified during review. Items marked as **[REQUIREMENT]** should be treated as core specifications. Items marked as **[RECOMMENDATION]** are suggested improvements to consider.*

## 3.1 TOM Navigation Behavior — [REQUIREMENT]

**Recommendation**: When user clicks a TOM from another chat, default to continuing in that chat with an option to branch.

**Rationale**: Users clicking a TOM typically want to continue that thread of thought. However, some may want to explore without modifying the original conversation.

**Implementation suggestion**:
- Default: Navigate to position, user continues in same chat
- Optional: "Branch to new chat" button near the marker, which creates a new chat with context from that point

---

## 3.2 Relevant TOMs and Cold Start Handling — [REQUIREMENT]

**Decision**: The system should never display a weak or empty "Relevant TOMs" section. When relevance confidence is low, default to showing Recent TOMs.

**Conditions for low confidence**:
- First visit (no chat history)
- Most recent interaction was low-signal (e.g., "what's the weather", simple factual queries)
- Session is stale (user returning after extended absence, e.g., 7+ days)

**Behavior**:
| Condition | Home Screen Display |
|-----------|---------------------|
| Strong relevance signal | Show "Related to your recent work" with relevant TOMs |
| Weak or no signal | Show "Your recent markers" (Recent TOMs) as default |
| No TOMs exist yet | Show empty state with guidance toward New Chat |

**Rationale**: Forcing relevance when the system isn't confident produces misleading results. Users trust the system more when it's honest about what it knows. "Recent" is always a valid fallback.

Note: Relevance Transparency
Recommendation: When strong relevance signal, show why each TOM is surfaced as "relevant."
Rationale: "Relevant TOMs" is ambiguous. Users benefit from understanding the connection.
Implementation suggestion:

Subtle subtext under each relevant TOM card
Example: "Related to: API rate limiting" or "Similar to your recent discussion"

---

## 3.3 Home Screen Layout — [REQUIREMENT]

**Decision**: Consolidate home screen into three elements with reduced decision points.

**Layout (top to bottom)**:

1. **Unified Search/New Chat Input**
   - Single input field at top
   - As user types, show matching TOMs below
   - If matches exist: display them for selection
   - If no matches: show "Start new chat about: [query]?" option
   - Empty input + submit: opens blank new chat

2. **TOM List with Toggle**
   - Single list area (not two separate sections)
   - Toggle between "Relevant" and "Recent" views
   - Default view follows confidence rules from 3.2
   - Smooth transition between views

3. **Legacy Chat List (Collapsed)**
   - Collapsed by default, expandable
   - Label: "All conversations" or similar
   - For users who need traditional navigation
   - Does not compete visually with TOM-based navigation

**Rationale**: The original design had five competing UI elements (search, new chat button, relevant TOMs, recent TOMs, legacy list). Users default to the path of least resistance — if "New Chat" is prominent and easy, TOM navigation gets ignored. The unified input nudges users toward TOM-based entry while preserving all functionality.

---

## 3.4 Marker Generation Quality Controls — [REQUIREMENT + RECOMMENDATION]

### 3.4.1 Density Awareness in Prompt — [REQUIREMENT]

Include conversation context in the TOM generation prompt:
- Number of messages since last marker
- Total markers in current conversation
- Example prompt addition: "This conversation has 2 markers so far. The last marker was created 5 messages ago."

This gives the LLM calibration signal to avoid over-marking (every response) or under-marking (missing obvious topic shifts).

### 3.4.2 User Marker Controls — [REQUIREMENT]

Users must be able to:
- **Delete** markers they find unhelpful (icon on hover, confirmation optional)
- **Edit** marker labels inline (click to edit, enter to save)

Deleted/edited markers should be logged (locally or server-side) as implicit feedback for potential future prompt tuning.

### 3.4.3 Manual Marker Creation — [RECOMMENDATION]

Allow users to manually add a marker to any AI response:
- "Add marker" option in message context menu or hover state
- User provides label
- Marker appears inline and in sidebar like auto-generated markers

**Rationale**: Users have context the AI doesn't. If a moment is significant to them, they should be able to mark it regardless of whether the AI detected it.

### 3.4.4 Early Calibration UX — [RECOMMENDATION]

For new users (first 5-10 chats), consider lightweight marker feedback:
- After AI response, occasionally show: "Was this a key moment? [Mark it] [Skip]"
- User input creates marker or skips
- Remove this scaffolding after calibration period

This trains user expectations about what markers are for, while generating explicit signal about marker quality.

Make this a toggable mode in settings UI.

---

## 3.5 Sidebar Design — [REQUIREMENT + RECOMMENDATION]

### 3.5.1 Collapsibility — [REQUIREMENT]

Sidebar must be collapsible to maximize chat space:
- Toggle button in chat header or sidebar header
- Collapsed state persists across navigation (user preference)
- When collapsed, markers remain accessible via alternative (see 3.5.2)

### 3.5.2 Collapsed State Access — [REQUIREMENT]

When sidebar is collapsed, provide marker access via:
- Floating "Markers" button, OR
- Dropdown in chat header

Clicking opens marker list as overlay or popover, not full sidebar.

### 3.5.3 Long Conversation Handling — [RECOMMENDATION]

For conversations with many markers (10+):
- Consider grouping by session/date
- Show current position indicator (which marker is currently in viewport)
- Fast scroll — keep animation under 300ms

### 3.5.4 Cross-Chat TOM Discovery — [OUT OF SCOPE, FUTURE CONSIDERATION]

Future enhancement to consider: When viewing a chat, the sidebar could show "Related markers in other chats" below the current chat's markers. This would enable cross-conversation discovery without returning to home screen.

For v1: Design sidebar component to accommodate additional marker sources later. Do not hardcode assumption that sidebar only shows current-chat TOMs.

---

## 3.6 Search Implementation — [REQUIREMENT]

### 3.6.1 Extended Context Storage

Each TOM should store:
- `label`: The marker text (under 60 characters)
- `extendedContext`: The user message + AI response that generated the marker

Search queries should match against both fields to improve recall. Label-only matching will produce weak results due to limited text.

### 3.6.2 Search Behavior

- Search is performed on input change (debounced, 200-300ms)
- Results ranked by relevance score
- Show source chat title and timestamp with each result
- Clicking result navigates to that TOM (per section 3.1 behavior)

### 3.6.3 Technical Approach (v1)

For initial implementation with Gemini API:
- Use Gemini API for semantic similarity

For production scale:
- Local vector store (IndexedDB with embeddings) or backend with vector search (pgvector or similar)
- This is a v2 optimization

---

## 3.7 Scroll and Animation — [REQUIREMENT]

- TOM navigation scroll: **300ms maximum**
- Highlight animation on arrival: **2 seconds**, subtle (background color fade)
- Users clicking TOMs want to arrive quickly, not watch smooth scrolling

---

*End of Section 3*