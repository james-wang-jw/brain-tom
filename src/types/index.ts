export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface TOMMarker {
  id: string;
  label: string;
  extendedContext: string;
  timestamp: number;
  chatId: string;
  messageIndex: number;
}

export interface MarkerFeedback {
  markerId: string;
  action: 'deleted' | 'edited';
  originalLabel?: string;
  timestamp: number;
}

export interface ClusterNode {
  id: string;            // 'cluster-' + nanoid
  label: string;         // LLM-generated 1-3 words
  memberIds: string[];   // TOMMarker IDs
  centroid: number[];    // averaged + L2-normalized embedding (768-dim)
  createdAt: number;
  updatedAt: number;
  previousLabel?: string; // for LLM context on re-labeling
}

export interface MarkerSynthesis {
  markerId: string;
  text: string;
  neighborhoodHash: string;
  generatedAt: number;
}
