/** Types mirroring the RefundShield API responses.
 *
 * Every score shown in the UI comes from these payloads. Nothing is computed
 * or hard-coded on the client.
 */

export type Band = 'LOW' | 'MODERATE' | 'HIGH' | 'VERY HIGH';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type ScenarioId = 'normal' | 'household' | 'isolated' | 'coordinated';

export interface Meta {
  synthetic_notice: string;
  scoring_notice: string;
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  summary: string;
  expected: string;
}

export interface ScenariosResponse extends Meta {
  scenarios: Scenario[];
  default: ScenarioId;
  threshold: number;
  bands: { label: string; range: string }[];
}

export interface DashboardCard {
  key: string;
  label: string;
  value: number;
  band: Band;
  link: string;
  hint: string;
}

export interface DashboardResponse extends Meta {
  scenario: ScenarioId;
  cards: DashboardCard[];
  totals: Record<string, number>;
  threshold: { value: number; signal: number; band: Band; observed: number; expected: number };
}

export interface ActivityEvent {
  kind: 'cluster' | 'threshold' | 'return';
  title: string;
  subject: string;
  detail: string;
  band: Band;
}

export interface QueueRow {
  rank: number;
  priority: Priority;
  priority_label: string;
  priority_score: number;
  return_id: string;
  account_id: string;
  order_id: string;
  claim_type: string;
  refund_inr: number;
  filed_on: string;
  return_rate_pct: number;
  individual_risk: number;
  individual_band: Band;
  threshold_signal: number;
  threshold_band: Band;
  network_evidence: number;
  network_band: Band;
  coordination_risk: number;
  coordination_band: Band;
  cluster_id: string | null;
  related_accounts: number;
  primary_reasons: string[];
  status: string;
  recommended_action: string;
  available_actions: string[];
}

export interface AccountRow {
  account_id: string;
  return_rate_pct: number;
  order_count: number;
  return_count: number;
  account_age_days: number;
  individual_risk: number;
  individual_band: Band;
  threshold_signal: number;
  in_window: boolean;
  coordination_risk: number;
  coordination_band: Band;
  cluster_id: string | null;
  related_accounts: number;
  categories: string[];
  device_ids: string[];
  address_id: string;
}

export interface ThresholdBin {
  lower: number;
  upper: number;
  lower_pct: number;
  upper_pct: number;
  label: string;
  count: number;
  role: 'window' | 'reference' | 'guard' | 'other';
  expected: number | null;
}

export interface ThresholdResult extends Meta {
  threshold: number;
  threshold_pct: number;
  window: [number, number];
  window_pct: [number, number];
  eligible_accounts: number;
  excluded_unreliable: number;
  observed_count: number;
  expected_count: number;
  excess_count: number;
  excess_ratio: number;
  p_value: number;
  bunching_score: number;
  signal_band: Band;
  reliable: boolean;
  reason: string;
  explanation: string;
  caveat: string;
  baseline_method: string;
  bins: ThresholdBin[];
  account_signals: Record<string, {
    account_id: string; return_rate_pct: number; in_window: boolean;
    proximity: number; signal: number; band: Band;
  }>;
}

export interface ThresholdFocus extends Meta {
  threshold: number;
  threshold_pct: number;
  window_pct: [number, number];
  range_pct: [number, number];
  bins: ThresholdBin[];
  observed_count: number;
  expected_count: number;
  excess_count: number;
  p_value: number;
  bunching_score: number;
  signal_band: Band;
  eligible_accounts: number;
  plain_english: string;
  caveat: string;
}

export interface EvidenceItem {
  code: string;
  category: string;
  label: string;
  strength: Band;
  detail: string;
  value: number;
}

export interface CoordinationBreakdown {
  individual_risk_context: number;
  threshold_evasion_signal: number;
  network_evidence: number;
  benign_factor: number;
  raw_before_benign: number;
  coordination_risk: number;
  band: Band;
  weights: { network: number; threshold: number; individual: number };
  notice: string;
}

export interface ClusterCoordination {
  cluster_id: string;
  account_ids: string[];
  size: number;
  coordination_risk: number;
  band: Band;
  breakdown: CoordinationBreakdown;
  in_window_share: number;
  evidence_categories: string[];
  independent_evidence_count: number;
  investigation_priority: Priority;
  recommended_action: string;
  action_note: string;
}

export interface Cluster {
  cluster_id: string;
  account_ids: string[];
  size: number;
  network_evidence: number;
  network_band: Band;
  components: Record<string, number>;
  benign_factor: number;
  benign_indicators: Record<string, number>;
  shared_devices: Record<string, string[]>;
  shared_addresses: Record<string, string[]>;
  shared_categories: string[];
  temporal_overlap: number;
  behavioural_similarity: number;
  claim_window: [string, string] | null;
  return_rate_range: [number, number];
  evidence_items: EvidenceItem[];
  coordination: ClusterCoordination;
}

export interface Explanation {
  subject: string;
  headline: string;
  reasons: string[];
  closing: string;
  caveat: string;
  human_in_the_loop: string;
}

export interface GraphNode {
  id: string;
  kind: 'account' | 'device' | 'address' | 'category';
  label: string;
  meta: Record<string, number | string>;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
  label: string;
  weight: number;
  detail: string;
}

export interface NetworkResponse extends Meta {
  focus: string;
  cluster_id: string | null;
  related_accounts: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  account_links: GraphEdge[];
  caveat: string;
}

export interface EvidenceGroup {
  category: string;
  hint: string;
  items: { title: string; value: string; strength: Band; explanation: string }[];
}

export interface StackRow { label: string; score: number; band: Band; hint: string }

export interface AccountDetail extends Meta {
  account_id: string;
  orders: number;
  returns: number;
  return_rate_pct: number;
  account_age_days: number;
  categories: string[];
  devices: string[];
  address: string;
  individual_risk: number; individual_band: Band;
  threshold_signal: number; threshold_band: Band; in_window: boolean;
  network_evidence: number; network_band: Band;
  coordination_risk: number; coordination_band: Band;
  cluster_id: string | null;
  related_accounts: string[];
  prioritised: boolean;
  verdict: string;
  rationale: string;
  evidence_groups: EvidenceGroup[];
  evidence_stack: StackRow[];
  explanation: Explanation;
}

export interface TimelineEvent {
  date: string;
  kind: 'account_created' | 'claim';
  account_id: string;
  return_id?: string;
  label: string;
  detail: string;
}

export interface TimelineResponse {
  cluster_id: string | null;
  events: TimelineEvent[];
  claim_window: { start: string; end: string; span_days: number; label: string } | null;
  claim_count: number;
}

export interface WhyNotIndividual {
  cluster_id: string;
  threshold_pct: number;
  accounts: {
    account_id: string; return_rate_pct: number;
    individual_risk: number; individual_band: Band; below_threshold: boolean;
  }[];
  rate_range_pct: [number, number];
  individual_range: [number, number];
  all_below_threshold: boolean;
  all_individually_low: boolean;
  headline: string;
  explanation: string;
  consequence: string;
}

export interface CaseState {
  status: string;
  notes: string;
  history: { action: string; label: string; status: string }[];
  notice: string;
}

export interface Investigation extends Meta {
  return: {
    return_id: string; account_id: string; order_id: string; claim_type: string;
    refund_inr: number; order_value_inr: number; filed_on: string;
    days_since_delivery: number; category: string; account_age_days: number;
  };
  risk_summary: {
    individual: { score: number; band: Band };
    threshold: { score: number; band: Band };
    network: { score: number; band: Band };
    coordination: { score: number; band: Band };
    priority: Priority;
    priority_score: number;
    notice: string;
  };
  account: AccountDetail;
  cluster_id: string | null;
  cluster: Cluster | null;
  primary_reasons: string[];
  recommended_action: string;
  action_note: string;
  available_actions: { key: string; label: string }[];
  case_state: CaseState;
  explanation: Explanation;
  why_not_individual: WhyNotIndividual | null;
  timeline: TimelineResponse;
}

export interface SearchResult {
  kind: 'account' | 'return' | 'cluster' | 'device' | 'address';
  id: string;
  primary: string;
  badges: { label: string; band: Band }[];
  route: string;
}

export interface Limitations extends Meta {
  limitations: string[];
  production_evolution: string[];
}
