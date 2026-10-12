export type Account = {
  id: string;
  label: string;
  department: string;
  country: string;
  office: string;
  tags: string[];
  enabled: boolean;
};
export type Installation = {
  id: string;
  accountId: string;
  platform: string;
  lastSeen: string | null;
  reachable: boolean;
  state: string;
  consent: { capture: boolean; shareText: boolean; reportStatus: boolean };
  gatewayActive?: boolean;
};
export type Tip = { id: string; title: string; detail: string; example: string };
export type UsageEvent = {
  id: string;
  accountId: string;
  receivedAt: string;
  provider: string;
  model: string;
  channel: string;
  label: string;
  task: string;
  redactedText: string;
  redactions: number;
  upstreamStatus?: number | null;
  redactedResponse?: string;
  responseStatus?: string;
  tips: Tip[];
};
export type Overview = {
  accounts: Account[];
  installations: Installation[];
  events: UsageEvent[];
  tasks: { id: string; label: string; count: number }[];
  opportunities: {
    id: string;
    title: string;
    description: string;
    task: string;
    count: number;
    stage: string;
  }[];
  totals: { accounts: number; events: number; redactions: number };
};
export type DesktopArtifact = {
  id: string;
  os: 'macos' | 'windows';
  arch: 'arm64' | 'x64';
  platform: string;
  version: string;
  url: string;
  sha256?: string | null;
  bytes?: number;
  signed: boolean;
  systemBrowser?: boolean;
};
export type Config = {
  organization: string;
  downloadUrl: string | null;
  hubUrl: string | null;
  centralReady?: boolean;
  downloadSha256?: string | null;
  downloadVersion?: string;
  desktopReleases?: DesktopArtifact[];
};
