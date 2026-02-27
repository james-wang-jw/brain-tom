import { create } from 'zustand';
import type { Chat, Message, TOMMarker } from '../types/index.ts';
import * as db from '../db/index.ts';
import { nanoid } from 'nanoid';
import { embedText } from '../api/embedding.ts';
import * as embeddingStore from '../utils/embeddingStore.ts';
import { hasApiKey } from '../utils/apiKey.ts';
import { getSearchMode } from '../utils/modelConfig.ts';

interface ChatState {
  // Current chat
  currentChat: Chat | null;
  markers: TOMMarker[];
  streamingContent: string;
  isStreaming: boolean;

  // Global lists
  allChats: Chat[];
  allMarkers: TOMMarker[];

  // UI state
  sidebarOpen: boolean;

  // Actions
  loadAllChats: () => Promise<void>;
  loadAllMarkers: () => Promise<void>;
  loadChat: (chatId: string) => Promise<void>;
  createChat: (title?: string) => Promise<Chat>;
  addMessage: (message: Message) => Promise<void>;
  updateChatTitle: (title: string) => Promise<void>;
  setStreamingContent: (content: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  addMarker: (marker: TOMMarker) => Promise<void>;
  updateMarker: (markerId: string, updates: { label?: string; extendedContext?: string; messageIndex?: number }) => Promise<void>;
  deleteMarker: (markerId: string) => Promise<void>;
  editMarkerLabel: (markerId: string, newLabel: string) => Promise<void>;
  replaceMessages: (messages: Message[]) => Promise<void>;
  deleteChatById: (chatId: string) => Promise<void>;
  clearAllData: () => Promise<void>;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  clearCurrentChat: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentChat: null,
  markers: [],
  streamingContent: '',
  isStreaming: false,
  allChats: [],
  allMarkers: [],
  sidebarOpen: localStorage.getItem('tom-sidebar-open') !== 'false',

  loadAllChats: async () => {
    const chats = await db.getAllChats();
    set({ allChats: chats });
  },

  loadAllMarkers: async () => {
    const markers = await db.getAllMarkers();
    set({ allMarkers: markers });
    // Hydrate embedding cache from IDB, then backfill missing embeddings
    embeddingStore.init().then(() => {
      if (getSearchMode() === 'embedding') {
        embeddingStore.backfillEmbeddings(markers).catch(() => {});
      }
    });
  },

  loadChat: async (chatId: string) => {
    const chat = await db.getChat(chatId);
    const markers = chat ? await db.getMarkersByChatId(chatId) : [];
    set({ currentChat: chat || null, markers });
  },

  createChat: async (title?: string) => {
    const chat: Chat = {
      id: nanoid(),
      title: title || 'New conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    await db.saveChat(chat);
    set({ currentChat: chat, markers: [] });
    // Update allChats
    const allChats = await db.getAllChats();
    set({ allChats });
    return chat;
  },

  addMessage: async (message: Message) => {
    const { currentChat } = get();
    if (!currentChat) return;
    const updated: Chat = {
      ...currentChat,
      messages: [...currentChat.messages, message],
      updatedAt: Date.now(),
    };
    await db.saveChat(updated);
    set({ currentChat: updated });
    // Update allChats list
    const allChats = await db.getAllChats();
    set({ allChats });
  },

  updateChatTitle: async (title: string) => {
    const { currentChat } = get();
    if (!currentChat) return;
    const updated = { ...currentChat, title, updatedAt: Date.now() };
    await db.saveChat(updated);
    set({ currentChat: updated });
    const allChats = await db.getAllChats();
    set({ allChats });
  },

  setStreamingContent: (content: string) => set({ streamingContent: content }),
  setIsStreaming: (streaming: boolean) => set({ isStreaming: streaming }),

  addMarker: async (marker: TOMMarker) => {
    await db.saveMarker(marker);
    const markers = await db.getMarkersByChatId(marker.chatId);
    const allMarkers = await db.getAllMarkers();
    set({ markers, allMarkers });
    // Fire-and-forget: embed the marker
    if (getSearchMode() === 'embedding' && hasApiKey('gemini')) {
      const text = marker.label + ' ' + (marker.extendedContext || '');
      embedText(text)
        .then((vec) => embeddingStore.setEmbedding(marker.id, vec))
        .catch((err) => console.warn('[chatStore] Failed to embed marker:', err));
    }
  },

  updateMarker: async (markerId, updates) => {
    await db.updateMarker(markerId, updates);
    const { currentChat } = get();
    if (currentChat) {
      const markers = await db.getMarkersByChatId(currentChat.id);
      set({ markers });
    }
    const allMarkers = await db.getAllMarkers();
    set({ allMarkers });
    // Fire-and-forget: re-embed the updated marker
    if (getSearchMode() === 'embedding' && hasApiKey('gemini')) {
      const updated = await db.getMarker(markerId);
      if (updated) {
        const text = updated.label + ' ' + (updated.extendedContext || '');
        embedText(text)
          .then((vec) => embeddingStore.setEmbedding(markerId, vec))
          .catch((err) => console.warn('[chatStore] Failed to re-embed marker:', err));
      }
    }
  },

  deleteMarker: async (markerId: string) => {
    const marker = await db.getMarker(markerId);
    if (marker) {
      await db.saveMarkerFeedback({
        markerId,
        action: 'deleted',
        originalLabel: marker.label,
        timestamp: Date.now(),
      });
    }
    await db.deleteMarker(markerId);
    embeddingStore.deleteEmbedding(markerId).catch(() => {});
    const { currentChat } = get();
    if (currentChat) {
      const markers = await db.getMarkersByChatId(currentChat.id);
      set({ markers });
    }
    const allMarkers = await db.getAllMarkers();
    set({ allMarkers });
  },

  editMarkerLabel: async (markerId: string, newLabel: string) => {
    const marker = await db.getMarker(markerId);
    if (marker) {
      await db.saveMarkerFeedback({
        markerId,
        action: 'edited',
        originalLabel: marker.label,
        timestamp: Date.now(),
      });
    }
    await db.updateMarkerLabel(markerId, newLabel);
    const { currentChat } = get();
    if (currentChat) {
      const markers = await db.getMarkersByChatId(currentChat.id);
      set({ markers });
    }
    const allMarkers = await db.getAllMarkers();
    set({ allMarkers });
  },

  replaceMessages: async (messages: Message[]) => {
    const { currentChat } = get();
    if (!currentChat) return;
    const updated: Chat = {
      ...currentChat,
      messages,
      updatedAt: Date.now(),
    };
    await db.saveChat(updated);
    set({ currentChat: updated });
    const allChats = await db.getAllChats();
    set({ allChats });
  },

  deleteChatById: async (chatId: string) => {
    // Delete embeddings for this chat's markers before deleting
    const chatMarkers = await db.getMarkersByChatId(chatId);
    for (const m of chatMarkers) {
      embeddingStore.deleteEmbedding(m.id).catch(() => {});
    }
    await db.deleteChat(chatId);
    const allChats = await db.getAllChats();
    const allMarkers = await db.getAllMarkers();
    set({ allChats, allMarkers });
  },

  clearAllData: async () => {
    await db.clearAllData();
    embeddingStore.clearAll();
    set({
      currentChat: null,
      markers: [],
      allChats: [],
      allMarkers: [],
      streamingContent: '',
      isStreaming: false,
    });
  },

  toggleSidebar: () => {
    const newState = !get().sidebarOpen;
    localStorage.setItem('tom-sidebar-open', String(newState));
    set({ sidebarOpen: newState });
  },

  setSidebarOpen: (open: boolean) => {
    localStorage.setItem('tom-sidebar-open', String(open));
    set({ sidebarOpen: open });
  },

  clearCurrentChat: () => {
    set({ currentChat: null, markers: [], streamingContent: '', isStreaming: false });
  },
}));
