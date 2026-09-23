/**
 * Frontend behaviour tests.
 *
 * The API is stubbed with payloads shaped exactly like the real backend
 * responses, so a change to the contract breaks a test rather than the demo.
 * Values asserted here (65.3, 89.2, 74.9, 21.1) are the engine's real outputs.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../state/AppContext';
import { api } from '../services/api';
import { Dashboard } from '../pages/Dashboard';
import { Investigations } from '../pages/Investigations';
import { InvestigationDetail } from '../pages/InvestigationDetail';
import { NetworkExplorer } from '../pages/NetworkExplorer';
import { ThresholdAnalysis } from '../pages/ThresholdAnalysis';
import { Accounts } from '../pages/Accounts';
import { AppShell } from '../components/layout/AppShell';

// ---------------------------------------------------------------- fixtures
const meta = { synthetic_notice: 'Synthetic demonstration environment — no real customer data.',
               scoring_notice: 'Prototype scoring logic — not a validated fraud probability.' };

const HERO_CLUSTER = {
  cluster_id: 'C-011',
  account_ids: ['ACC-1032', 'ACC-1047', 'ACC-1051', 'ACC-1062', 'ACC-1078'],
  size: 5, network_evidence: 74.9, network_band: 'HIGH' as const,
  components: { link_strength: 0.44, category_overlap: 1, claim_timing: 1,
                claim_homogeneity: 0.39, rate_tightness: 0.96 },
  benign_factor: 0.9, benign_indicators: {},
  shared_devices: { 'DEV-017': ['ACC-1032', 'ACC-1047', 'ACC-1062'] },
  shared_addresses: { 'ADDR-009': ['ACC-1047', 'ACC-1051', 'ACC-1078'] },
  shared_categories: ['Electronics', 'Small Appliances'],
  temporal_overlap: 1, behavioural_similarity: 0.97,
  claim_window: ['2026-09-03', '2026-09-09'] as [string, string],
  return_rate_range: [18.4, 19.1] as [number, number],
  evidence_items: [
    { code: 'shared_device', category: 'relational', label: 'Shared device',
      strength: 'HIGH' as const, detail: '3 accounts use DEV-017.', value: 0.9 },
    { code: 'claim_timing', category: 'temporal', label: 'Similar claim timing',
      strength: 'HIGH' as const, detail: 'Claims fall between 2026-09-03 and 2026-09-09.', value: 1 },
  ],
  coordination: {
    cluster_id: 'C-011', account_ids: [], size: 5,
    coordination_risk: 65.3, band: 'HIGH' as const,
    breakdown: {
      individual_risk_context: 21.3, threshold_evasion_signal: 89.2,
      network_evidence: 74.9, benign_factor: 0.9, raw_before_benign: 72.6,
      coordination_risk: 65.3, band: 'HIGH' as const,
      weights: { network: 0.45, threshold: 0.4, individual: 0.15 },
      notice: 'Prototype coordination score — not a fraud probability.',
    },
    in_window_share: 1, evidence_categories: ['behavioural', 'population', 'relational', 'temporal'],
    independent_evidence_count: 4, investigation_priority: 'URGENT' as const,
    recommended_action: 'PRIORITISE FOR REVIEW',
    action_note: 'RefundShield prioritises cases for investigation. It does not automatically deny refunds.',
  },
};

const HOUSEHOLD_CLUSTER = {
  ...HERO_CLUSTER, cluster_id: 'C-009',
  account_ids: ['ACC-1014', 'ACC-1015', 'ACC-1016', 'ACC-1017'], size: 4,
  network_evidence: 55.0, network_band: 'MODERATE' as const, benign_factor: 0.2,
  coordination: {
    ...HERO_CLUSTER.coordination, cluster_id: 'C-009',
    coordination_risk: 5.1, band: 'LOW' as const,
    investigation_priority: 'LOW' as const,
    breakdown: { ...HERO_CLUSTER.coordination.breakdown,
                 coordination_risk: 5.1, band: 'LOW' as const,
                 threshold_evasion_signal: 0, network_evidence: 55.0, benign_factor: 0.2 },
  },
};

const QUEUE_ROW = {
  rank: 1, priority: 'HIGH' as const, priority_label: 'P1', priority_score: 47.7,
  return_id: 'RET-7137', account_id: 'ACC-1078', order_id: 'ORD-6273',
  claim_type: 'Damaged item', refund_inr: 32970, filed_on: '2026-09-07',
  return_rate_pct: 19.1, individual_risk: 21.5, individual_band: 'LOW' as const,
  threshold_signal: 89.2, threshold_band: 'VERY HIGH' as const,
  network_evidence: 74.9, network_band: 'HIGH' as const,
  coordination_risk: 65.4, coordination_band: 'HIGH' as const,
  cluster_id: 'C-011', related_accounts: 4,
  primary_reasons: ['Near-threshold cluster', 'Shared device'],
  status: 'Awaiting review', recommended_action: 'PRIORITISE FOR REVIEW',
  available_actions: ['Review Evidence'],
};

const ACCOUNT_DETAIL = {
  ...meta, account_id: 'ACC-1078', orders: 47, returns: 9, return_rate_pct: 19.1,
  account_age_days: 119, categories: ['Electronics'], devices: ['DEV-054'], address: 'ADDR-009',
  individual_risk: 21.5, individual_band: 'LOW' as const,
  threshold_signal: 73.2, threshold_band: 'HIGH' as const, in_window: true,
  network_evidence: 74.9, network_band: 'HIGH' as const,
  coordination_risk: 65.4, coordination_band: 'HIGH' as const,
  cluster_id: 'C-011', related_accounts: ['ACC-1032'], prioritised: true,
  verdict: 'WHY THIS ACCOUNT IS PRIORITISED',
  rationale: 'Individually this account looks acceptable.',
  evidence_groups: [{ category: 'RELATIONAL', hint: 'Attributes shared with other accounts.',
    items: [{ title: 'Shared device', value: '0.90', strength: 'HIGH' as const,
              detail: '', explanation: '3 accounts use DEV-017.' }] }],
  evidence_stack: [
    { label: 'Individual behaviour', score: 21.5, band: 'LOW' as const, hint: 'h' },
    { label: 'Threshold evasion', score: 89.2, band: 'VERY HIGH' as const, hint: 'h' },
    { label: 'Network evidence', score: 74.9, band: 'HIGH' as const, hint: 'h' },
    { label: 'Temporal alignment', score: 100, band: 'VERY HIGH' as const, hint: 'h' },
  ],
  explanation: { subject: 'ACC-1078', headline: 'Individually low risk, but part of a group',
                 reasons: ['Individual return risk is 21.5/100 (LOW).'],
                 closing: 'c', caveat: 'No single shared attribute proves fraud.',
                 human_in_the_loop: 'h' },
};

const INVESTIGATION = {
  ...meta,
  return: { return_id: 'RET-7137', account_id: 'ACC-1078', order_id: 'ORD-6273',
            claim_type: 'Damaged item', refund_inr: 32970, order_value_inr: 32970,
            filed_on: '2026-09-07', days_since_delivery: 5, category: 'Electronics',
            account_age_days: 119 },
  risk_summary: {
    individual: { score: 21.5, band: 'LOW' as const },
    threshold: { score: 89.2, band: 'VERY HIGH' as const },
    network: { score: 74.9, band: 'HIGH' as const },
    coordination: { score: 65.4, band: 'HIGH' as const },
    priority: 'HIGH' as const, priority_score: 47.7,
    notice: 'Prototype coordination score — not a fraud probability.',
  },
  account: ACCOUNT_DETAIL, cluster_id: 'C-011', cluster: HERO_CLUSTER,
  primary_reasons: ['Near-threshold cluster'],
  recommended_action: 'PRIORITISE FOR REVIEW',
  action_note: 'RefundShield prioritises cases for investigation. It does not automatically deny refunds.',
  available_actions: [
    { key: 'review', label: 'Review Evidence' },
    { key: 'request_evidence', label: 'Request More Evidence' },
    { key: 'approve_refund', label: 'Approve Refund' },
    { key: 'escalate', label: 'Escalate for Investigation' },
  ],
  case_state: { status: 'Awaiting review', notes: '', history: [],
                notice: 'Demo action — no real refund or payment action performed.' },
  explanation: { subject: 'C-011',
    headline: 'Potential coordinated return abuse — coordination risk HIGH (65/100)',
    reasons: ['All 5 accounts remain below the seller’s 20.0% return-rate threshold.',
              '3 accounts share device DEV-017: ACC-1032, ACC-1047, ACC-1062.'],
    closing: 'These combined signals increase coordination risk.',
    caveat: 'No single shared attribute proves fraud.',
    human_in_the_loop: 'RefundShield prioritises cases for investigation.' },
  why_not_individual: {
    cluster_id: 'C-011', threshold_pct: 20,
    accounts: HERO_CLUSTER.account_ids.map((id, i) => ({
      account_id: id, return_rate_pct: [18.4, 18.8, 19.0, 18.6, 19.1][i],
      individual_risk: [21.1, 21.2, 21.4, 21.2, 21.5][i],
      individual_band: 'LOW' as const, below_threshold: true })),
    rate_range_pct: [18.4, 19.1] as [number, number],
    individual_range: [21.1, 21.5] as [number, number],
    all_below_threshold: true, all_individually_low: true,
    headline: 'Individual scoring alone does not flag these accounts',
    explanation: 'Each account remains below the seller’s 20% threshold.',
    consequence: 'RefundShield therefore evaluates population-level threshold behaviour.',
  },
  timeline: { cluster_id: 'C-011', claim_count: 31,
    claim_window: { start: '2026-09-03', end: '2026-09-09', span_days: 6,
                    label: 'Activity window: 2026-09-03 → 2026-09-09 (6 days)' },
    events: [{ date: '2026-09-07', kind: 'claim' as const, account_id: 'ACC-1078',
               return_id: 'RET-7137', label: 'Damaged item', detail: 'RET-7137 · ₹32,970' }] },
};

const NETWORK = {
  ...meta, focus: 'ACC-1032', cluster_id: 'C-011',
  related_accounts: ['ACC-1047', 'ACC-1051', 'ACC-1062', 'ACC-1078'],
  nodes: [
    { id: 'ACC-1032', kind: 'account' as const, label: 'ACC-1032',
      meta: { return_rate_pct: 18.4, orders: 38, returns: 7 } },
    { id: 'DEV-017', kind: 'device' as const, label: 'DEV-017',
      meta: { accounts: 3, rarity: 0.9 } },
  ],
  edges: [{ source: 'ACC-1032', target: 'DEV-017', kind: 'shared_device',
            label: 'Shared device', weight: 0.36, detail: 'DEV-017 is used by 3 accounts.' }],
  account_links: [],
  caveat: 'Connections provide context. Behavioural evidence is required to strengthen investigation priority.',
};

const THRESHOLD = {
  ...meta, threshold: 0.2, threshold_pct: 20, window: [0.18, 0.2] as [number, number],
  window_pct: [18, 20] as [number, number], eligible_accounts: 90, excluded_unreliable: 10,
  observed_count: 6, expected_count: 1.29, excess_count: 4.71, excess_ratio: 3.67,
  p_value: 0.002113, bunching_score: 89.2, signal_band: 'VERY HIGH' as const,
  reliable: true, reason: '',
  explanation: '6 reliable accounts are concentrated between 18% and 20%.',
  caveat: 'Threshold-evasion analysis identifies a population-level pattern.',
  baseline_method: 'local linear trend fit over reference bins below the window',
  bins: [
    { lower: 0.17, upper: 0.18, lower_pct: 17, upper_pct: 18, label: '17-18%',
      count: 1, role: 'reference' as const, expected: null },
    { lower: 0.18, upper: 0.19, lower_pct: 18, upper_pct: 19, label: '18-19%',
      count: 4, role: 'window' as const, expected: 1.0 },
    { lower: 0.19, upper: 0.2, lower_pct: 19, upper_pct: 20, label: '19-20%',
      count: 2, role: 'window' as const, expected: 0.29 },
  ],
  account_signals: {},
};

const THRESHOLD_FOCUS = {
  ...meta, threshold: 0.2, threshold_pct: 20, window_pct: [18, 20] as [number, number],
  range_pct: [12, 22] as [number, number], bins: THRESHOLD.bins,
  observed_count: 6, expected_count: 1.29, excess_count: 4.71, p_value: 0.002113,
  bunching_score: 89.2, signal_band: 'VERY HIGH' as const, eligible_accounts: 90,
  plain_english: 'More accounts than expected are concentrated immediately below the seller’s 20% review threshold.',
  caveat: 'It does not determine that any individual customer is fraudulent.',
};

function stubApi(overrides: Partial<Record<keyof typeof api, unknown>> = {}) {
  vi.spyOn(api, 'dashboard').mockResolvedValue({
    ...meta, scenario: 'coordinated',
    cards: [
      { key: 'urgent', label: 'Priority investigations', value: 31, band: 'VERY HIGH', link: 'queue', hint: 'h' },
      { key: 'coordination', label: 'High coordination risk', value: 1, band: 'HIGH', link: 'network', hint: 'h' },
      { key: 'threshold', label: 'Threshold anomalies', value: 2, band: 'VERY HIGH', link: 'threshold', hint: 'h' },
      { key: 'clusters', label: 'Active clusters', value: 11, band: 'LOW', link: 'network', hint: 'h' },
    ],
    totals: { return_requests: 140, accounts: 100 },
    threshold: { value: 0.2, signal: 89.2, band: 'VERY HIGH', observed: 6, expected: 1.29 },
  } as never);
  vi.spyOn(api, 'clusters').mockResolvedValue({ clusters: [HERO_CLUSTER] } as never);
  vi.spyOn(api, 'queue').mockResolvedValue({
    queue: [QUEUE_ROW], total: 1,
    human_in_the_loop: 'RefundShield prioritises cases for investigation. It does not automatically deny refunds.',
  } as never);
  vi.spyOn(api, 'activity').mockResolvedValue({
    events: [{ kind: 'cluster', title: 'Cluster identified', subject: 'C-011',
               detail: '5 linked accounts', band: 'HIGH' }], environment: 'SYNTHETIC DEMO' } as never);
  vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [{
    account_id: 'ACC-1078', return_rate_pct: 19.1, order_count: 47, return_count: 9,
    account_age_days: 119, individual_risk: 21.5, individual_band: 'LOW',
    threshold_signal: 73.2, in_window: true, coordination_risk: 65.4,
    coordination_band: 'HIGH', cluster_id: 'C-011', related_accounts: 4,
    categories: ['Electronics'], device_ids: ['DEV-054'], address_id: 'ADDR-009' }] } as never);
  vi.spyOn(api, 'investigation').mockResolvedValue(INVESTIGATION as never);
  vi.spyOn(api, 'accountDetail').mockResolvedValue(ACCOUNT_DETAIL as never);
  vi.spyOn(api, 'network').mockResolvedValue(NETWORK as never);
  vi.spyOn(api, 'threshold').mockResolvedValue(THRESHOLD as never);
  vi.spyOn(api, 'thresholdFocus').mockResolvedValue(THRESHOLD_FOCUS as never);
  vi.spyOn(api, 'clusterTimeline').mockResolvedValue(INVESTIGATION.timeline as never);
  vi.spyOn(api, 'search').mockResolvedValue({
    query: 'ACC-1032', total: 1,
    results: [{ kind: 'account', id: 'ACC-1032', primary: '18.4%',
                badges: [{ label: 'Individual', band: 'LOW' },
                         { label: 'Coordination', band: 'HIGH' }],
                route: '/accounts/ACC-1032' }] } as never);
  vi.spyOn(api, 'applyAction').mockResolvedValue({
    return_id: 'RET-7137',
    case_state: { status: 'Escalated for investigation', notes: '',
                  history: [{ action: 'escalate', label: 'Escalate for Investigation',
                              status: 'Escalated for investigation' }],
                  notice: 'Demo action — no real refund or payment action performed.' },
  } as never);
  Object.entries(overrides).forEach(([k, v]) => {
    vi.spyOn(api, k as keyof typeof api).mockImplementation(v as never);
  });
}

function renderAt(ui: React.ReactNode, path = '/', routePath = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Routes><Route path={routePath} element={ui} /></Routes>
      </AppProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); stubApi(); });
afterEach(() => { vi.restoreAllMocks(); });

// ==========================================================================
describe('Dashboard', () => {
  it('loads and shows metric cards from the API', async () => {
    renderAt(<Dashboard />);
    expect(await screen.findByText('Priority investigations')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('31')).toBeInTheDocument(), { timeout: 2500 });
    expect(screen.getByText('Active clusters')).toBeInTheDocument();
  });

  it('shows the hero coordination score from the engine, not a constant', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('65.3')).toBeInTheDocument(), { timeout: 2500 });
    expect(screen.getByRole('heading', { name: /Cluster C-011/ })).toBeInTheDocument();
    expect(screen.getByText('URGENT')).toBeInTheDocument();
  });

  it('never offers an automatic refund denial', async () => {
    renderAt(<Dashboard />);
    await screen.findByRole('heading', { name: /Cluster C-011/ });
    // The caveat legitimately contains the phrase "deny refunds" (as a negation),
    // so assert on ACTIONS: there must be no control that denies or rejects.
    expect(screen.queryByRole('button', { name: /deny|reject|block/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /deny|reject|block/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not automatically deny refunds/i)).toBeInTheDocument();
  });

  it('renders a polished error state when the API fails', async () => {
    vi.spyOn(api, 'dashboard').mockRejectedValue(new Error('boom'));
    renderAt(<Dashboard />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();  // no raw error leaked
  });
});

describe('Investigation queue', () => {
  it('loads rows with every evidence stream', async () => {
    renderAt(<Investigations />);
    expect(await screen.findByText('RET-7137')).toBeInTheDocument();
    expect(screen.getByText('ACC-1078')).toBeInTheDocument();
    expect(screen.getAllByText('65.4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('89.2').length).toBeGreaterThan(0);
  });

  it('filters rows and offers a way back', async () => {
    const user = userEvent.setup();
    renderAt(<Investigations />);
    await screen.findByText('RET-7137');
    await user.click(screen.getByRole('button', { name: 'URGENT' }));
    expect(await screen.findByText(/No investigations match your filters/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(await screen.findByText('RET-7137')).toBeInTheDocument();
  });

  it('searches by account id', async () => {
    const user = userEvent.setup();
    renderAt(<Investigations />);
    await screen.findByText('RET-7137');
    await user.type(screen.getByLabelText(/filter investigations/i), 'ACC-9999');
    expect(await screen.findByText(/No investigations match/i)).toBeInTheDocument();
  });
});

describe('Investigation detail', () => {
  const open = () => renderAt(<InvestigationDetail />, '/investigations/RET-7137',
                              '/investigations/:returnId');

  it('shows all four evidence streams with real values', async () => {
    open();
    expect(await screen.findByText(/Potential coordinated return abuse/)).toBeInTheDocument();
    expect(screen.getByText('21.5')).toBeInTheDocument();
    expect(screen.getAllByText('89.2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('74.9').length).toBeGreaterThan(0);
    expect(screen.getByText('65.4')).toBeInTheDocument();
  });

  it('renders the aha moment with the five hero accounts', async () => {
    open();
    await screen.findByText(/Why individual scoring did not catch this/);
    for (const rate of ['18.4%', '18.8%', '19%', '18.6%', '19.1%']) {
      expect(screen.getAllByText(rate).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('Individually normal. Collectively suspicious.')).toBeInTheDocument();
  });

  it('lists generated explanation evidence, not hard-coded text', async () => {
    open();
    await screen.findByText(/Why was this case prioritised\?/);
    expect(screen.getByText(/3 accounts share device DEV-017/)).toBeInTheDocument();
    expect(screen.getByText(/No single shared attribute proves fraud/)).toBeInTheDocument();
  });

  it('shows the timeline built from real dates', async () => {
    open();
    await screen.findByText(/Recorded activity/);
    expect(screen.getByText(/2026-09-03/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-09/)).toBeInTheDocument();
  });

  it('updates case status locally and says no real action occurred', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText(/Investigator action/);
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /escalate for investigation/i }));
    await waitFor(() =>
      expect(screen.getAllByText(/Escalated for investigation/).length).toBeGreaterThan(0));
    expect(api.applyAction).toHaveBeenCalledWith('RET-7137', 'coordinated', 'escalate', undefined);
    expect(screen.getByText(/no real refund or payment action performed/i)).toBeInTheDocument();
  });

  it('offers no reject-refund action anywhere', async () => {
    open();
    await screen.findByText(/Investigator action/);
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deny/i })).not.toBeInTheDocument();
  });

  it('fails gracefully for an unknown case', async () => {
    vi.spyOn(api, 'investigation').mockRejectedValue(new Error('404'));
    open();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Unable to load investigation data/i)).toBeInTheDocument();
  });
});

describe('Network explorer', () => {
  it('renders the graph and selects a node', async () => {
    const user = userEvent.setup();
    renderAt(<NetworkExplorer />, '/network', '/network');
    await screen.findByRole('img', { name: /relationship graph/i });
    await user.click(screen.getByRole('button', { name: /Account ACC-1032/i }));
    // the rate appears on the node itself and again in the inspector
    await waitFor(() => expect(screen.getAllByText('18.4%').length).toBeGreaterThan(1));
  });

  it('warns that shared infrastructure is not proof when a device is selected', async () => {
    const user = userEvent.setup();
    renderAt(<NetworkExplorer />, '/network', '/network');
    await screen.findByRole('img', { name: /relationship graph/i });
    await user.click(screen.getByRole('button', { name: /Device DEV-017/i }));
    expect(await screen.findByText(/Shared infrastructure is not proof of fraud/i))
      .toBeInTheDocument();
  });

  it('explains a selected relationship', async () => {
    const user = userEvent.setup();
    const { container } = renderAt(<NetworkExplorer />, '/network', '/network');
    await screen.findByRole('img', { name: /relationship graph/i });
    const edge = container.querySelector('line[stroke]');
    await user.click(edge!);
    expect(await screen.findByText(/DEV-017 is used by 3 accounts/)).toBeInTheDocument();
  });
});

describe('Threshold analysis', () => {
  it('receives real engine values', async () => {
    renderAt(<ThresholdAnalysis />, '/threshold', '/threshold');
    expect(await screen.findByText('20%')).toBeInTheDocument();
    // every reading counts up, so wait for the settled values
    await waitFor(() => {
      expect(screen.getByText('6')).toBeInTheDocument();
      expect(screen.getByText('1.29')).toBeInTheDocument();
      expect(screen.getByText('+4.71')).toBeInTheDocument();
      expect(screen.getByText('0.0021')).toBeInTheDocument();
    }, { timeout: 2500 });
    expect(screen.getAllByText('89.2').length).toBeGreaterThan(0);
  });

  it('states that the signal is not proof of fraud', async () => {
    renderAt(<ThresholdAnalysis />, '/threshold', '/threshold');
    await screen.findByText(/What the signal means/);
    expect(screen.getByText(/does not independently establish fraud/i)).toBeInTheDocument();
  });
});

describe('Scenario behaviour', () => {
  it('household shows network overlap with LOW coordination', async () => {
    vi.spyOn(api, 'clusters').mockResolvedValue({ clusters: [HOUSEHOLD_CLUSTER] } as never);
    renderAt(<Dashboard />);
    await screen.findByRole('heading', { name: /Cluster C-009/ });
    expect(screen.getByText('55.0')).toBeInTheDocument();     // network overlap present
    await waitFor(() => expect(screen.getByText('5.1')).toBeInTheDocument(),
                  { timeout: 2500 });                          // coordination LOW
    expect(screen.getAllByText('LOW').length).toBeGreaterThan(0);
  });

  it('isolated abuse shows high individual risk with low coordination', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({ accounts: [{
      account_id: 'ACC-1073', return_rate_pct: 34.5, order_count: 29, return_count: 10,
      account_age_days: 165, individual_risk: 79.9, individual_band: 'HIGH',
      threshold_signal: 0, in_window: false, coordination_risk: 12.0,
      coordination_band: 'LOW', cluster_id: null, related_accounts: 0,
      categories: ['Electronics'], device_ids: ['DEV-070'], address_id: 'ADDR-061' }] } as never);
    renderAt(<Accounts />, '/accounts', '/accounts');
    expect(await screen.findByText('ACC-1073')).toBeInTheDocument();
    expect(screen.getByText('79.9')).toBeInTheDocument();
    expect(screen.getByText('12.0')).toBeInTheDocument();
  });

  it('switching scenario refetches every view', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppProvider><AppShell><Dashboard /></AppShell></AppProvider>
      </MemoryRouter>);
    await screen.findByRole('heading', { name: /Cluster C-011/ });
    const before = (api.dashboard as ReturnType<typeof vi.fn>).mock.calls.length;
    await user.click(screen.getByRole('button', { name: /coordinated/i }));
    await user.click(await screen.findByRole('option', { name: /Legitimate Shared Household/i }));
    await waitFor(() =>
      expect((api.dashboard as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(before));
    expect(api.dashboard).toHaveBeenLastCalledWith('household');
  });
});

describe('Shell', () => {
  const shell = () => render(
    <MemoryRouter><AppProvider><AppShell><Dashboard /></AppShell></AppProvider></MemoryRouter>);

  it('opens the command palette with Ctrl+K', async () => {
    const user = userEvent.setup();
    shell();
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Run Hero Investigation/i })).toBeInTheDocument();
  });

  it('searches accounts globally', async () => {
    const user = userEvent.setup();
    shell();
    await user.type(screen.getByLabelText(/global search/i), 'ACC-1032');
    expect(await screen.findByRole('option', { name: /ACC-1032/ })).toBeInTheDocument();
    expect(api.search).toHaveBeenCalledWith('ACC-1032', 'coordinated');
  });

  it('toggles theme and persists the choice', async () => {
    const user = userEvent.setup();
    shell();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    await user.click(screen.getByRole('button', { name: /switch to dark theme/i }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(localStorage.getItem('refundshield.theme')).toBe('dark');
  });

  it('always shows the synthetic environment indicator', async () => {
    shell();
    expect(screen.getAllByText(/synthetic environment/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/API connected/i)).toBeInTheDocument();
  });
});

describe('Reduced motion', () => {
  it('shows final values immediately when the OS asks for reduced motion', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(((q: string) => ({
      matches: q.includes('reduce'), media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })) as never);
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('31')).toBeInTheDocument(), { timeout: 2500 });
    await waitFor(() =>
      expect(document.documentElement.classList.contains('reduce-motion')).toBe(true));
  });
});
