/** The single place the frontend talks to the backend.
 *
 * No component calls fetch() directly. Every value rendered anywhere in the app
 * originates from one of these calls.
 */
import type {
  AccountDetail, AccountRow, ActivityEvent, Cluster, DashboardResponse,
  Investigation, Limitations, NetworkResponse, QueueRow, ScenarioId,
  ScenariosResponse, SearchResult, ThresholdFocus, ThresholdResult,
  TimelineResponse, WhyNotIndividual,
} from '../types/models';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '') || '';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly url: string) {
    super(message);
    this.name = 'ApiError';
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}/api${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // Network-level failure: the API is not reachable at all.
    throw new ApiError('Unable to reach the RefundShield API.', 0, url);
  }
  if (!res.ok) {
    // Never surface a stack trace or raw server text to the user.
    const msg = res.status === 404
      ? 'That record could not be found.'
      : 'The RefundShield API could not complete this request.';
    throw new ApiError(msg, res.status, url);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  scenarios: () => request<ScenariosResponse>('/scenarios'),

  dashboard: (scenario: ScenarioId) =>
    request<DashboardResponse>(`/dashboard${qs({ scenario })}`),

  activity: (scenario: ScenarioId, limit = 8) =>
    request<{ events: ActivityEvent[]; environment: string }>(
      `/activity${qs({ scenario, limit })}`),

  queue: (scenario: ScenarioId, limit = 500) =>
    request<{ queue: QueueRow[]; total: number; human_in_the_loop: string }>(
      `/investigation-queue${qs({ scenario, limit })}`),

  accounts: (scenario: ScenarioId) =>
    request<{ accounts: AccountRow[] }>(`/accounts${qs({ scenario })}`),

  accountDetail: (accountId: string, scenario: ScenarioId) =>
    request<AccountDetail>(`/accounts/${encodeURIComponent(accountId)}/detail${qs({ scenario })}`),

  investigation: (returnId: string, scenario: ScenarioId) =>
    request<Investigation>(`/investigations/${encodeURIComponent(returnId)}${qs({ scenario })}`),

  applyAction: (returnId: string, scenario: ScenarioId, action: string, note?: string) =>
    request<{ return_id: string; case_state: Investigation['case_state'] }>(
      `/investigations/${encodeURIComponent(returnId)}/action`,
      { method: 'POST', body: JSON.stringify({ action, note, scenario }) }),

  saveNotes: (returnId: string, scenario: ScenarioId, note: string) =>
    request<{ return_id: string; case_state: Investigation['case_state'] }>(
      `/investigations/${encodeURIComponent(returnId)}/notes`,
      { method: 'POST', body: JSON.stringify({ note, scenario }) }),

  clusters: (scenario: ScenarioId) =>
    request<{ clusters: Cluster[] }>(`/clusters${qs({ scenario })}`),

  clusterTimeline: (clusterId: string, scenario: ScenarioId) =>
    request<TimelineResponse>(`/clusters/${encodeURIComponent(clusterId)}/timeline${qs({ scenario })}`),

  whyNotIndividual: (clusterId: string, scenario: ScenarioId) =>
    request<WhyNotIndividual>(
      `/clusters/${encodeURIComponent(clusterId)}/why-not-individual${qs({ scenario })}`),

  network: (accountId: string, scenario: ScenarioId, relationship = 'all') =>
    request<NetworkResponse>(
      `/network/${encodeURIComponent(accountId)}${qs({ scenario, relationship })}`),

  /** `threshold` overrides the seller policy for this call only — the engine
   *  recomputes the whole bunching estimate against the new line. */
  threshold: (scenario: ScenarioId, threshold?: number) =>
    request<ThresholdResult>(`/threshold-analysis${qs({ scenario, threshold })}`),

  thresholdFocus: (scenario: ScenarioId, threshold?: number) =>
    request<ThresholdFocus>(`/threshold-focus${qs({ scenario, threshold })}`),

  search: (q: string, scenario: ScenarioId) =>
    request<{ query: string; results: SearchResult[]; total: number }>(
      `/search${qs({ q, scenario })}`),

  limitations: () => request<Limitations>('/limitations'),

  demoHero: () => request<Record<string, unknown>>('/demo/hero'),
};

export type Api = typeof api;
