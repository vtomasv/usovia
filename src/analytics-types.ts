import type { Account } from './types';
export type OutcomeStatus =
  'validated' | 'positive_signal' | 'needs_revision' | 'technical_issue' | 'unknown';
export type Outcome = {
  status: OutcomeStatus;
  label: string;
  source: string;
  evidence: string;
  eventId: string | null;
  reviewStale: boolean;
  reviewedAt?: string;
};
export type SessionSummary = {
  key: string;
  id: string;
  account: Account;
  provider: string;
  model: string;
  channel: string;
  turnCount: number;
  answerCount: number;
  firstAt: string;
  lastAt: string;
  hasGaps: boolean;
  limited: boolean;
  category: string;
  concepts: { id: string; label: string }[];
  preview: string;
  outcome: Outcome;
};
export type Solution = {
  key: string;
  account: Account;
  category: string;
  title: string;
  status: OutcomeStatus;
  source: string;
  evidence: string;
  eventId: string;
  prompt: string;
  response: string;
  complete: boolean;
  limited: boolean;
  lastAt: string;
};
export type Graph = {
  executionMode?: 'vercel_on_demand' | 'private_worker';
  worker: { lastSeen: string; recent: boolean; model: string } | null;
  method: string;
  model: string;
  threshold: number;
  indexedSessions: number;
  totalSessions: number;
  visibleSessions: number;
  omittedNodes: number;
  pending: number;
  failed: number;
  nodes: {
    key: string;
    accountId: string;
    accountLabel: string;
    department: string;
    category: string;
    status: OutcomeStatus;
    turns: number;
    preview: string;
    group: number;
  }[];
  edges: { source: string; target: string; similarity: number }[];
  clusters: {
    id: number;
    sessionKeys: string[];
    sessions: number;
    accounts: number;
    label: string;
  }[];
  layout: string;
  scope: string;
};
export type Filters = {
  account: string;
  department: string;
  office: string;
  tag: string;
  category: string;
  outcome: string;
  query: string;
  from: string;
  to: string;
};
export type DashboardData = {
  generatedAt: string;
  retention: { days: number; maxTurns: number };
  summary: {
    sessions: number;
    turns: number;
    accounts: number;
    departments: number;
    answers: number;
    completeAnswers: number;
    validated: number;
    positiveSignals: number;
    unknown: number;
  };
  categories: { id: string; label: string; sessions: number; validated: number; turns: number }[];
  outcomes: { id: OutcomeStatus; label: string; count: number }[];
  activity: { date: string; turns: number; sessions: number }[];
  teams: { department: string; sessions: number; accounts: number }[];
  processes: {
    id: string;
    label: string;
    sessions: number;
    accounts: number;
    departments: number;
    validated: number;
    positiveSignals: number;
    sessionKeys: string[];
    nextStep: string;
  }[];
  solutions: Solution[];
  sessions: SessionSummary[];
  sessionListOmitted: number;
  semantic: Graph;
  facets: {
    departments: string[];
    offices: string[];
    tags: string[];
    categories: { id: string; label: string }[];
  };
  interpretation: { success: string; sample: string; period: string };
};
export type ExportManifest = {
  id: string;
  dataset: string;
  includeText: boolean;
  createdAt: string;
  expiresAt: string;
  rowCount: number;
  schemaVersion: number;
  retention: { days: number; maxTurns: number };
  parts: { index: number; rows: number; filename: string; url: string }[];
};
export type AccountEntry = Account & {
  sessions: number;
  turns: number;
  lastActivity: string | null;
  installation: {
    lastSeen: string | null;
    reachable: boolean;
    state: string;
    consent: {
      capture: boolean;
      shareText: boolean;
      captureResponses?: boolean;
      reportStatus: boolean;
    };
  } | null;
};
export type DirectoryData = {
  accounts: AccountEntry[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  departments: string[];
};
