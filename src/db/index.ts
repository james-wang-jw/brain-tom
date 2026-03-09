import { openDB, type IDBPDatabase } from 'idb';
import type { Chat, TOMMarker, MarkerFeedback, ClusterNode, MarkerSynthesis } from '../types/index.ts';

const DB_NAME = 'tom-app';
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Chats store
        if (!db.objectStoreNames.contains('chats')) {
          const chatStore = db.createObjectStore('chats', { keyPath: 'id' });
          chatStore.createIndex('updatedAt', 'updatedAt');
        }
        // Markers store
        if (!db.objectStoreNames.contains('markers')) {
          const markerStore = db.createObjectStore('markers', { keyPath: 'id' });
          markerStore.createIndex('chatId', 'chatId');
          markerStore.createIndex('timestamp', 'timestamp');
        }
        // Marker feedback store
        if (!db.objectStoreNames.contains('markerFeedback')) {
          db.createObjectStore('markerFeedback', { keyPath: 'markerId' });
        }
        // Embeddings store (v2)
        if (!db.objectStoreNames.contains('embeddings')) {
          db.createObjectStore('embeddings', { keyPath: 'markerId' });
        }
        // Clusters store (v3)
        if (!db.objectStoreNames.contains('clusters')) {
          db.createObjectStore('clusters', { keyPath: 'id' });
        }
        // Syntheses store (v4)
        if (!db.objectStoreNames.contains('syntheses')) {
          db.createObjectStore('syntheses', { keyPath: 'markerId' });
        }
      },
    });
  }
  return dbPromise;
}

// === Chats ===

export async function saveChat(chat: Chat): Promise<void> {
  const db = await getDB();
  await db.put('chats', chat);
}

export async function getChat(id: string): Promise<Chat | undefined> {
  const db = await getDB();
  return db.get('chats', id);
}

export async function getAllChats(): Promise<Chat[]> {
  const db = await getDB();
  const chats = await db.getAllFromIndex('chats', 'updatedAt');
  return chats.reverse(); // newest first
}

export async function deleteChat(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('chats', id);
  // Also delete associated markers and their embeddings
  const markers = await getMarkersByChatId(id);
  const tx = db.transaction(['markers', 'embeddings'], 'readwrite');
  for (const marker of markers) {
    await tx.objectStore('markers').delete(marker.id);
    await tx.objectStore('embeddings').delete(marker.id);
  }
  await tx.done;
}

// === Markers ===

export async function saveMarker(marker: TOMMarker): Promise<void> {
  const db = await getDB();
  await db.put('markers', marker);
}

export async function getMarker(id: string): Promise<TOMMarker | undefined> {
  const db = await getDB();
  return db.get('markers', id);
}

export async function getMarkersByChatId(chatId: string): Promise<TOMMarker[]> {
  const db = await getDB();
  return db.getAllFromIndex('markers', 'chatId', chatId);
}

export async function getAllMarkers(): Promise<TOMMarker[]> {
  const db = await getDB();
  const markers = await db.getAllFromIndex('markers', 'timestamp');
  return markers.reverse(); // newest first
}

export async function deleteMarker(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('markers', id);
}

export async function updateMarkerLabel(id: string, newLabel: string): Promise<void> {
  const db = await getDB();
  const marker = await db.get('markers', id);
  if (marker) {
    marker.label = newLabel;
    await db.put('markers', marker);
  }
}

export async function updateMarker(
  id: string,
  updates: { label?: string; extendedContext?: string; messageIndex?: number },
): Promise<void> {
  const db = await getDB();
  const marker = await db.get('markers', id);
  if (marker) {
    if (updates.label !== undefined) marker.label = updates.label;
    if (updates.extendedContext !== undefined) marker.extendedContext = updates.extendedContext;
    if (updates.messageIndex !== undefined) marker.messageIndex = updates.messageIndex;
    marker.timestamp = Date.now();
    await db.put('markers', marker);
  }
}

// === Marker Feedback ===

export async function saveMarkerFeedback(feedback: MarkerFeedback): Promise<void> {
  const db = await getDB();
  await db.put('markerFeedback', feedback);
}

// === Embeddings ===

export async function saveEmbedding(markerId: string, vector: number[]): Promise<void> {
  const db = await getDB();
  await db.put('embeddings', { markerId, vector });
}

export async function getAllEmbeddings(): Promise<{ markerId: string; vector: number[] }[]> {
  const db = await getDB();
  return db.getAll('embeddings');
}

export async function deleteEmbedding(markerId: string): Promise<void> {
  const db = await getDB();
  await db.delete('embeddings', markerId);
}

// === Clusters ===

export async function saveCluster(cluster: ClusterNode): Promise<void> {
  const db = await getDB();
  await db.put('clusters', cluster);
}

export async function getAllClusters(): Promise<ClusterNode[]> {
  const db = await getDB();
  return db.getAll('clusters');
}

export async function deleteCluster(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('clusters', id);
}

export async function saveClusters(clusters: ClusterNode[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('clusters', 'readwrite');
  for (const cluster of clusters) {
    await tx.store.put(cluster);
  }
  await tx.done;
}

export async function replaceAllClusters(clusters: ClusterNode[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('clusters', 'readwrite');
  await tx.store.clear();
  for (const cluster of clusters) {
    await tx.store.put(cluster);
  }
  await tx.done;
}

// === Syntheses ===

export async function getSynthesis(markerId: string): Promise<MarkerSynthesis | undefined> {
  const db = await getDB();
  return db.get('syntheses', markerId);
}

export async function saveSynthesis(synthesis: MarkerSynthesis): Promise<void> {
  const db = await getDB();
  await db.put('syntheses', synthesis);
}

export async function deleteSynthesis(markerId: string): Promise<void> {
  const db = await getDB();
  await db.delete('syntheses', markerId);
}

export async function clearAllSyntheses(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('syntheses', 'readwrite');
  await tx.store.clear();
  await tx.done;
}

// === Clear all data ===

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['chats', 'markers', 'markerFeedback', 'embeddings', 'clusters', 'syntheses'], 'readwrite');
  await tx.objectStore('chats').clear();
  await tx.objectStore('markers').clear();
  await tx.objectStore('markerFeedback').clear();
  await tx.objectStore('embeddings').clear();
  await tx.objectStore('clusters').clear();
  await tx.objectStore('syntheses').clear();
  await tx.done;
}
