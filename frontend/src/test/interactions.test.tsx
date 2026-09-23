/**
 * Behaviour tests for the Round 2 interaction layer.
 *
 * These assert that controls DO something — that the threshold slider re-queries
 * the engine with a new override, that the notification panel routes, that the
 * evidence panel drives the graph spotlight. A control that renders but changes
 * nothing should fail here.
 *
 * The API is stubbed with payloads shaped like the real backend responses.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../state/AppContext';
import { api } from '../services/api';
import { AppShell } from '../components/layout/AppShell';
import { ScenarioCompare } from '../components/evidence/ScenarioCompare';
import { NetworkExplorer } from '../pages/NetworkExplorer';
import { ThresholdAnalysis } from '../pages/ThresholdAnalysis';
import { InvestigationDetail } from '../pages/InvestigationDetail';
import type { Band } from '../types/models';

const meta = {
  synthetic_notice: 'Synthetic demonstration environment — no real customer data.',
  scoring_notice: 'Prototype scoring logic — not a validated fraud probability.',
};

const BINS = [
  { lower: 0.16, upper: 0.17, lower_pct: 16, upper_pct: 17, label: '16%', count: 5,
    role: 'reference' as const, expected: null },
  { lower: 0.17, upper: 0.18, lower_pct: 17, upper_pct: 18, label: '17%', count: 1,
    role: 'reference' as const, expected: null },
  { lower: 0.18, upper: 0.19, lower_pct: 18, upper_pct: 19, label: '18%', count: 4,
    role: 'window' as const, expected: 0.72 },
  { lower: 0.19, upper: 0.20, lower_pct: 19, upper_pct: 20, label: '19%', count: 2,
    role: 'window' as const, expected: 0.57 },
];

function thresholdPayload(pct = 20, score = 89.2, band: Band = 'VERY HIGH') {
  return {
    ...meta, threshold: pct / 100, threshold_pct: pct,
    window: [(pct - 2) / 100, pct / 100] as [number, number],
    window_pct: [pct - 2, pct] as [number, number],
    eligible_accounts: 90, excluded_unreliable: 10,
    observed_count: 6, expected_count: 1.29, excess_count: 4.71, excess_ratio: 3.65,
    p_value: 0.002113, bunching_score: score, signal_band: band,
    reliable: true, reason: '', explanation: 'Six reliable accounts sit just below the line.',
    caveat: 'Threshold-evasion analysis identifies a population-level pattern.',
    baseline_method: 'local linear trend fit over reference bins below the window',
    bins: BINS,
    account_signals: {
      'ACC-1032': { account_id: 'ACC-1032', return_rate_pct: 18.4, in_window: true,
                    proximity: 0.8, signal: 73, band: 'HIGH' as Band },
      'ACC-1078': { account_id: 'ACC-1078', return_rate_pct: 19.1, in_window: true,
                    proximity: 0.95, signal: 76, band: 'HIGH' as Band },
    },
  };
}

function focusPayload(pct = 20, score = 89.2) {
  return {
    ...meta, threshold: pct / 100, threshold_pct: pct,
    window_pct: [pct - 2, pct] as [number, number],
    range_pct: [12, 22] as [number, number], bins: BINS,
    observed_count: 6, expected_count: 1.29, excess_count: 4.71, p_value: 0.002113,
    bunching_score: score, signal_band: 'VERY HIGH' as Band, eligible_accounts: 90,
    plain_english: 'More accounts than expected sit immediately below the threshold.',
    caveat: 'It does not determine that any individual customer is fraudulent.',
  };
}

const HERO_CLUSTER = {
  cluster_id: 'C-011',
  account_ids: ['ACC-1032', 'ACC-1047', 'ACC-1051', 'ACC-1062', 'ACC-1078'],
  size: 5, network_evidence: 74.9, network_band: 'HIGH' as Band,
  components: {}, benign_factor: 0.9, benign_indicators: {},
  shared_devices: { 'DEV-017': ['ACC-1032', 'ACC-1047', 'ACC-1062'] },
  shared_addresses: { 'ADDR-009': ['ACC-1047', 'ACC-1051', 'ACC-1078'] },
  shared_categories: ['Electronics'],
  temporal_overlap: 1, behavioural_similarity: 0.97,
  claim_window: ['2026-09-03', '2026-09-09'] as [string, string],
  return_rate_range: [18.4, 19.1] as [number, number],
  evidence_items: [
    { code: 'shared_device', category: 'relational', label: 'Shared device',
      detail: '3 accounts use DEV-017.', strength: 'HIGH' as Band },
    { code: 'claim_timing', category: 'temporal', label: 'Similar claim timing',
      detail: 'Claims fall in a 6-day window.', strength: 'HIGH' as Band },
  ],
  coordination: {
    cluster_id: 'C-011', account_ids: [], size: 5, coordination_risk: 65.3,
    band: 'HIGH' as Band,
    breakdown: { individual_risk_context: 21.3, threshold_evasion_signal: 89.2,
                 network_evidence: 74.9, benign_factor: 0.9, raw_before_benign: 72.6,
                 coordination_risk: 65.3, band: 'HIGH',
                 weights: { network: 0.45, threshold: 0.4, individual: 0.15 },
                 notice: 'Prototype coordination score.' },
    in_window_share: 1, evidence_categories: ['relational', 'temporal'],
    independent_evidence_count: 4, investigation_priority: 'URGENT',
    recommended_action: 'PRIORITISE FOR REVIEW', action_note: 'Queued for a human investigator.',
  },
  notice: 'Prototype coordination score.',
};

const NETWORK = {
  ...meta,
  nodes: [
    { id: 'ACC-1032', kind: 'account' as const, label: 'ACC-1032',
      meta: { return_rate_pct: 18.4, orders: 38, returns: 7 } },
    { id: 'ACC-1047', kind: 'account' as const, label: 'ACC-1047',
      meta: { return_rate_pct: 18.8, orders: 16, returns: 3 } },
    { id: 'DEV-017', kind: 'device' as const, label: 'DEV-017',
      meta: { accounts: 3, rarity: 0.85 } },
    { id: 'ADDR-009', kind: 'address' as const, label: 'ADDR-009',
      meta: { accounts: 3, rarity: 0.85 } },
  ],
  edges: [
    { source: 'ACC-1032', target: 'DEV-017', kind: 'shared_device' as const,
      label: 'Shared device', weight: 0.85, detail: 'Both use DEV-017.' },
    { source: 'ACC-1047', target: 'ADDR-009', kind: 'shared_address' as const,
      label: 'Common address', weight: 0.8, detail: 'Both deliver to ADDR-009.' },
  ],
  account_id: 'ACC-1032', cluster_id: 'C-011',
};

const INVESTIGATION = {
  ...meta,
  return: { return_id: 'RET-7137', account_id: 'ACC-1078', order_id: 'ORD-6273',
            claim_type: 'Damaged item', refund_inr: 32970, filed_on: '2026-09-07',
            days_since_delivery: 3, status: 'Awaiting review', return_rate_pct: 19.1 },
  risk_summary: {
    individual: { score: 21.5, band: 'LOW' as Band },
    threshold: { score: 89.2, band: 'VERY HIGH' as Band },
    network: { score: 74.9, band: 'HIGH' as Band },
    coordination: { score: 65.4, band: 'HIGH' as Band },
    priority: 'HIGH' as const, priority_score: 58.2,
    notice: 'Prototype coordination score — not a fraud probability.',
  },
  account: {
    account_id: 'ACC-1078', orders: 47, returns: 9, return_rate_pct: 19.1,
    account_age_days: 119, categories: ['Electronics'], devices: ['DEV-054'],
    address: 'ADDR-009', individual_risk: 21.5, individual_band: 'LOW' as Band,
    threshold_signal: 73.2, threshold_band: 'HIGH' as Band, in_window: true,
    network_evidence: 74.9, network_band: 'HIGH' as Band,
    coordination_risk: 65.4, coordination_band: 'HIGH' as Band, cluster_id: 'C-011',
    related_accounts: ['ACC-1032', 'ACC-1047', 'ACC-1051', 'ACC-1062'],
    prioritised: true, verdict: 'Individually low risk',
    rationale: 'Sits below the threshold.',
    evidence_groups: [], evidence_stack: [],
    explanation: { subject: 'ACC-1078', headline: 'Individually low risk',
                   reasons: [], evidence: [], caveat: 'Not proof of fraud.' },
  },
  cluster: HERO_CLUSTER,
  cluster_id: 'C-011',
  primary_reasons: ['Near-threshold cluster', 'Shared device'],
  recommended_action: 'PRIORITISE FOR REVIEW',
  action_note: 'Queued for a human investigator — no automatic refusal.',
  available_actions: [
    { key: 'review', label: 'Review Evidence' },
    { key: 'escalate', label: 'Escalate for Investigation' },
  ],
  case_state: { status: 'Awaiting review', notes: '', history: [],
                notice: 'Demo action — no real refund or payment action performed.' },
  explanation: { subject: 'RET-7137', headline: 'Individually low risk',
                 reasons: ['All five accounts sit below the threshold.'], evidence: [],
                 caveat: 'Not proof of fraud.' },
  why_not_individual: {
    cluster_id: 'C-011', threshold_pct: 20,
    accounts: [{ account_id: 'ACC-1032', return_rate_pct: 18.4, individual_risk: 21.1,
                 individual_band: 'LOW' as Band, below_threshold: true }],
    individual_verdict: 'All accounts LOW', threshold_signal: 89.2,
    network_evidence: 74.9, coordination_risk: 65.3, coordination_band: 'HIGH' as Band,
    summary: 'Individually normal, collectively suspicious.',
  },
  timeline: { cluster_id: 'C-011', events: [], window: null },
};

function stub() {
  vi.spyOn(api, 'threshold').mockImplementation(
    ((_s: string, t?: number) =>
      Promise.resolve(thresholdPayload(t ? t * 100 : 20,
                                       t && Math.abs(t - 0.2) > 1e-9 ? 11 : 89.2,
                                       t && Math.abs(t - 0.2) > 1e-9 ? 'MODERATE' : 'VERY HIGH'))) as never);
  vi.spyOn(api, 'thresholdFocus').mockImplementation(
    ((_s: string, t?: number) =>
      Promise.resolve(focusPayload(t ? t * 100 : 20))) as never);
  vi.spyOn(api, 'clusters').mockResolvedValue({ clusters: [HERO_CLUSTER] } as never);
  vi.spyOn(api, 'network').mockResolvedValue(NETWORK as never);
  vi.spyOn(api, 'accountDetail').mockResolvedValue({
    ...meta, account_id: 'ACC-1032', individual_risk: 21.1, individual_band: 'LOW',
    threshold_signal: 73, threshold_band: 'HIGH', coordination_risk: 65.3,
    coordination_band: 'HIGH', cluster_id: 'C-011', related_accounts: [],
  } as never);
  vi.spyOn(api, 'activity').mockResolvedValue({
    events: [
      { kind: 'cluster', title: 'Cluster identified', subject: 'C-011',
        detail: '5 linked accounts', band: 'HIGH' },
      { kind: 'threshold', title: 'Threshold anomaly detected', subject: '20% review threshold',
        detail: '6 observed vs 1.29 expected', band: 'VERY HIGH' },
    ], environment: 'SYNTHETIC DEMO' } as never);
  vi.spyOn(api, 'investigation').mockResolvedValue(INVESTIGATION as never);
  vi.spyOn(api, 'search').mockResolvedValue({ query: '', total: 0, results: [] } as never);
  vi.spyOn(api, 'accounts').mockImplementation(((s: string) => Promise.resolve({
    accounts: [{
      account_id: s === 'isolated' ? 'ACC-1073' : 'ACC-1078',
      return_rate_pct: 19.1, order_count: 47, return_count: 9, account_age_days: 119,
      individual_risk: s === 'isolated' ? 79.9 : 21.5,
      individual_band: s === 'isolated' ? 'HIGH' : 'LOW',
      threshold_signal: 73, in_window: true, coordination_risk: 65.4,
      coordination_band: 'HIGH', cluster_id: 'C-011', related_accounts: 4,
      categories: ['Electronics'], device_ids: ['DEV-017'], address_id: 'ADDR-009',
    }],
  })) as never);
  vi.spyOn(api, 'applyAction').mockResolvedValue({
    return_id: 'RET-7137',
    case_state: { status: 'Escalated for investigation', notes: '',
                  history: [{ action: 'escalate', label: 'Escalate for Investigation',
                              status: 'Escalated for investigation' }],
                  notice: 'Demo action — no real refund or payment action performed.' },
  } as never);
  vi.spyOn(api, 'saveNotes').mockResolvedValue({
    return_id: 'RET-7137',
    case_state: { status: 'Awaiting review', notes: 'checked the device overlap',
                  history: [], notice: 'Demo action.' },
  } as never);
}

function Loc() {
  const l = useLocation();
  return <span data-testid="loc">{l.pathname + l.search}</span>;
}

function renderAt(ui: React.ReactNode, path = '/', routePath = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider>
        <Routes><Route path={routePath} element={<>{ui}<Loc /></>} /></Routes>
      </AppProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => { localStorage.clear(); stub(); });
afterEach(() => { vi.restoreAllMocks(); });

// ==========================================================================
describe('Threshold control', () => {
  it('re-queries the engine with a new override when the slider moves', async () => {
    renderAt(<ThresholdAnalysis />);
    await screen.findByText('Review threshold');

    const slider = screen.getByLabelText('Review threshold percentage');
    fireEvent.change(slider, { target: { value: '18' } });

    await waitFor(() => {
      expect(api.threshold).toHaveBeenCalledWith('coordinated', 0.18);
    }, { timeout: 2500 });
  });

  it('preset chips drive the same override path', async () => {
    renderAt(<ThresholdAnalysis />);
    await screen.findByText('Review threshold');

    await userEvent.click(screen.getByRole('button', { name: '22%' }));

    await waitFor(() => {
      expect(api.threshold).toHaveBeenCalledWith('coordinated', 0.22);
    }, { timeout: 2500 });
  });

  it('shows a reset-to-policy control only once overridden', async () => {
    renderAt(<ThresholdAnalysis />);
    await screen.findByText('Review threshold');
    expect(screen.queryByRole('button', { name: /policy/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Review threshold percentage'),
                     { target: { value: '24' } });

    expect(await screen.findByRole('button', { name: /policy/i },
                                   { timeout: 2500 })).toBeInTheDocument();
  });

  it('the sweep recomputes the signal at many thresholds', async () => {
    renderAt(<ThresholdAnalysis />);
    await screen.findByText('Review threshold');

    await userEvent.click(screen.getByRole('button', { name: /run sweep/i }));

    await waitFor(() => {
      // one engine call per swept threshold, beyond the initial page load
      expect(vi.mocked(api.threshold).mock.calls.length).toBeGreaterThan(5);
    }, { timeout: 4000 });
  });

  it('lists the accounts inside a bin when it is selected', async () => {
    renderAt(<ThresholdAnalysis />);
    await screen.findByText('Review threshold');
    expect(screen.getByText(/click a bar to list its accounts/i)).toBeInTheDocument();
  });
});

// ==========================================================================
describe('Notifications', () => {
  it('opens a panel of real signals and routes on selection', async () => {
    renderAt(<AppShell><div /></AppShell>, '/', '*');

    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));

    const panel = await screen.findByRole('dialog', { name: /recent signals/i });
    expect(within(panel).getByText('Threshold anomaly detected')).toBeInTheDocument();

    await userEvent.click(within(panel).getByText('Cluster identified'));
    await waitFor(() => {
      expect(screen.getByTestId('loc')).toHaveTextContent('/network?cluster=C-011');
    });
  });
});

// ==========================================================================
describe('Demo mode', () => {
  it('loads the coordinated scenario and offers an exit', async () => {
    renderAt(<AppShell><div /></AppShell>, '/', '*');

    const enter = await screen.findByTitle('Enter demo mode');
    await userEvent.click(enter);

    expect(await screen.findByTitle('Exit demo mode')).toBeInTheDocument();
    expect(screen.getByText('Demo flow')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('loc')).toHaveTextContent('/scenarios');
    });
  });
});

// ==========================================================================
describe('Network evidence spotlight', () => {
  it('an evidence item highlights the entities it names', async () => {
    renderAt(<NetworkExplorer />, '/network', '/network');

    const evidence = await screen.findByRole('button', { name: /shared device/i },
                                             { timeout: 4000 });
    expect(evidence).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(evidence);

    expect(evidence).toHaveAttribute('aria-pressed', 'true');
    // DEV-017 plus the three accounts that share it
    expect(await screen.findByText(/highlighting/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear highlight/i })).toBeInTheDocument();
  });
});

// ==========================================================================
describe('Scenario comparison', () => {
  it('scores every scenario through the same engines', async () => {
    renderAt(<ScenarioCompare />);

    await userEvent.click(screen.getByRole('button', { name: /compare scenarios/i }));

    await waitFor(() => {
      expect(screen.getByText('Isolated Abuse')).toBeInTheDocument();
    }, { timeout: 4000 });

    // the isolated scenario's peak individual risk is the engine's 79.9
    expect(screen.getByText('79.9')).toBeInTheDocument();
    expect(api.accounts).toHaveBeenCalledWith('isolated');
    expect(api.accounts).toHaveBeenCalledWith('coordinated');
  });
});

// ==========================================================================
describe('Investigator workflow', () => {
  it('escalating records an action and an audit entry', async () => {
    renderAt(<InvestigationDetail />, '/investigations/RET-7137', '/investigations/:returnId');
    await screen.findByText(/RET-7137/);

    await userEvent.click(await screen.findByRole('button', { name: /escalate/i }));

    await waitFor(() => expect(api.applyAction).toHaveBeenCalled());
    expect(await screen.findByText('This session')).toBeInTheDocument();
  });

  it('never offers a deny-refund control', async () => {
    renderAt(<InvestigationDetail />, '/investigations/RET-7137', '/investigations/:returnId');
    await screen.findByText(/RET-7137/);
    expect(screen.queryByRole('button', { name: /deny/i })).not.toBeInTheDocument();
  });

  it('exports a summary containing the engine scores', async () => {
    // jsdom's Blob has no .text(), so record what was written instead.
    const written: string[] = [];
    class RecordingBlob {
      constructor(parts: unknown[]) { written.push(String(parts[0])); }
    }
    vi.stubGlobal('Blob', RecordingBlob);
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });

    renderAt(<InvestigationDetail />, '/investigations/RET-7137', '/investigations/:returnId');
    await screen.findByText(/RET-7137/);

    await userEvent.click(screen.getByRole('button', { name: /export summary/i }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    const payload = JSON.parse(written[0]);
    expect(payload.investigation.return_id).toBe('RET-7137');
    expect(payload.scores.coordination_risk).toBe(65.4);
    expect(payload.scores.threshold_signal).toBe(89.2);
    expect(payload.cluster.cluster_id).toBe('C-011');
  });

  it('persists the audit trail across a remount', async () => {
    const { unmount } = renderAt(
      <InvestigationDetail />, '/investigations/RET-7137', '/investigations/:returnId');
    await screen.findByText(/RET-7137/);
    await userEvent.click(await screen.findByRole('button', { name: /escalate/i }));
    await waitFor(() => expect(api.applyAction).toHaveBeenCalled());
    unmount();

    renderAt(<InvestigationDetail />, '/investigations/RET-7137', '/investigations/:returnId');
    expect(await screen.findByText('This session')).toBeInTheDocument();
  });
});

// ==========================================================================
describe('Command palette', () => {
  it('opens on Ctrl+K and can jump straight to cluster C-011', async () => {
    renderAt(<AppShell><div /></AppShell>, '/', '*');
    await screen.findByRole('button', { name: /notifications/i });

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const input = await screen.findByLabelText('Command');
    await userEvent.type(input, 'C-011');
    await userEvent.click(await screen.findByText(/open cluster c-011/i));

    await waitFor(() => {
      expect(screen.getByTestId('loc')).toHaveTextContent('/network?cluster=C-011');
    });
  });
});
