export interface VideoData {
  title: string;
  summary: string;
  url?: string;
  publishDate?: string;
}

export interface GraphNode {
  id: string;
  group: number; // 1 for main concepts, 2 for secondary, 3 for specific arguments
  desc?: string;
  longDescription?: string; // Detailed analysis for modal
  relevance: number; // 1-10 scale
  popularity: number; // 1-10 scale
}

export interface GraphLink {
  source: string;
  target: string;
  value: number;
}

export interface TopicGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  summary: string;
}

export interface Slide {
  title: string;
  bulletPoints: string[];
  rebuttal: string;
  speakerNotes: string;
  visualPrompt: string;
}

export interface PresentationData {
  slides: Slide[];
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING', // Searching and building graph
  DASHBOARD = 'DASHBOARD', // Showing graph and video list
  GENERATING_SLIDES = 'GENERATING_SLIDES',
  PRESENTATION = 'PRESENTATION'
}