import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const roots = new WeakMap();

// Dark theme palette aligned with Vaani AI Design System (brand.css & media_1788551580193.png)
const PALETTE = {
  lime: '#B9FF66',          // Primary neon lime (paid, answered, active)
  orange: '#FF9B22',        // Vibrant citrus orange (invoiced, warning, caution)
  blue: '#52A8FF',          // Electric sky blue (calls, secondary metrics)
  sage: '#C5E1A5',          // Soft pale sage (quaternary signal)
  red: '#FF5252',           // Alert red (spend, critical, overdue)
  cardBg: '#1F1F1F',        // Primary card background surface
  surface: '#1F1F1F',       // Primary surface
  surface2: '#212121',      // Secondary surface
  textPrimary: '#FFFFFF',   // Primary text
  textSecondary: '#B5B5B5', // Secondary text
  textMuted: '#777777',     // Muted axis and label text
  grid: 'rgba(255, 255, 255, 0.05)', // Subtle dark grid lines
  axis: '#777777',          // Muted gray axis text
  axisLine: 'rgba(255, 255, 255, 0.20)', // Subtle axis stroke
  axisCategory: '#B5B5B5',  // Secondary text for vertical category axes
  tooltipBg: '#1F1F1F',     // Dark sunken surface
  tooltipBorder: 'rgba(255, 255, 255, 0.10)',
};

const COLORS = [PALETTE.lime, PALETTE.orange, PALETTE.blue, PALETTE.sage, PALETTE.red];

function formatInrPaise(value) {
  return `₹${(Number(value || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function shortDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function tooltipLabel(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? shortDate(value) : String(value || '');
}

function axisInr(value) {
  const inr = Number(value || 0) / 100;
  if (inr >= 100000) return `₹${(inr / 100000).toFixed(inr >= 1000000 ? 0 : 1)}L`;
  if (inr >= 1000) return `₹${Math.round(inr / 1000)}k`;
  return `₹${Math.round(inr)}`;
}

const customTooltipStyle = {
  backgroundColor: PALETTE.tooltipBg,
  border: `1px solid ${PALETTE.tooltipBorder}`,
  borderRadius: '10px',
  padding: '10px 14px',
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
  color: '#FFFFFF',
  fontSize: '0.74rem',
  lineHeight: '1.45',
};

function MoneyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip" style={customTooltipStyle}>
      <strong style={{ display: 'block', color: '#FFFFFF', marginBottom: '6px', fontSize: '0.76rem' }}>
        {tooltipLabel(label)}
      </strong>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', color: '#B5B5B5' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: item.color || item.fill, flexShrink: 0 }} />
          <span>{item.name}:</span>
          <strong style={{ color: '#FFFFFF', marginLeft: 'auto', fontWeight: 600 }}>
            {item.dataKey.toLowerCase().includes('paise') ? formatInrPaise(item.value) : Number(item.value || 0).toLocaleString('en-IN')}
          </strong>
        </div>
      ))}
    </div>
  );
}

function CountTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-tooltip" style={customTooltipStyle}>
      <strong style={{ display: 'block', color: '#FFFFFF', marginBottom: '6px', fontSize: '0.76rem' }}>
        {tooltipLabel(label)}
      </strong>
      {payload.map((item) => (
        <div key={item.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', color: '#B5B5B5' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: item.color || item.fill, flexShrink: 0 }} />
          <span>{item.name}:</span>
          <strong style={{ color: '#FFFFFF', marginLeft: 'auto', fontWeight: 600 }}>
            {Number(item.value || 0).toLocaleString('en-IN')}
          </strong>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const item = payload[0];
  return (
    <div className="chart-tooltip" style={customTooltipStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B5B5B5' }}>
        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: item.payload?.fill || item.color, flexShrink: 0 }} />
        <span>{String(item.name).replace('_', ' ')}:</span>
        <strong style={{ color: '#FFFFFF', marginLeft: 'auto', fontWeight: 600 }}>
          {Number(item.value || 0).toLocaleString('en-IN')}
        </strong>
      </div>
    </div>
  );
}

function CountUp({ value, money = false }) {
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = React.useState(reduceMotion ? value : 0);
  React.useEffect(() => {
    if (reduceMotion) { setShown(value); return undefined; }
    let frame = 0;
    const started = performance.now();
    const draw = (now) => {
      const progress = Math.min(1, (now - started) / 650);
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(Number(value || 0) * eased));
      if (progress < 1) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [value, reduceMotion]);
  return money ? formatInrPaise(shown) : Number(shown || 0).toLocaleString('en-IN');
}

function Metric({ label, value, note, money, tone }) {
  return (
    <article className={`agency-metric ${tone || ''}`}>
      <div className="agency-metric-label">{label}</div>
      <div className="agency-metric-value"><CountUp value={value} money={money} /></div>
      <div className="agency-metric-note">{note}</div>
    </article>
  );
}

function EmptyChart({ text }) {
  return <div className="chart-empty">{text}</div>;
}

function AgencyDashboard({ data }) {
  const kpis = data.kpis || {};
  const days = data.days || [];
  const comparison = data.comparisons || [];
  const portfolio = (data.portfolio || []).filter((row) => row.count > 0);
  const hasMoney = days.some((row) => row.invoicedPaise || row.paidPaise);
  const hasActivity = comparison.some((row) => row.calls || row.activity);

  return (
    <div className="agency-analytics" aria-label="Agency analytics">
      <section className="agency-metrics" aria-label="Agency metrics">
        <Metric label="Revenue recorded" value={kpis.paidPaise} money note="Paid invoices in Agency OS" tone="positive" />
        <Metric label="Outstanding" value={kpis.outstandingPaise} money note="Issued and not marked paid" tone="warning" />
        <Metric label="Active clients" value={kpis.activeClients} note={`${Number(kpis.clients || 0).toLocaleString('en-IN')} total workspaces`} />
        <Metric label="Client activity" value={kpis.activity} note={`${Number(kpis.calls || 0).toLocaleString('en-IN')} tracked calls`} />
      </section>

      <section className="agency-chart-grid">
        <article className="agency-chart-card revenue-chart-card">
          <header>
            <div><span className="section-kicker">Financial pulse</span><h3>Revenue and collections</h3></div>
            <span className="chart-range">Last 30 days</span>
          </header>
          <p className="chart-summary">Invoices are the revenue authority. Wallet credit is excluded.</p>
          <div className="chart-canvas" role="img" aria-label={`Thirty day invoice chart. Paid ${formatInrPaise(kpis.paidPaise)}, outstanding ${formatInrPaise(kpis.outstandingPaise)}.`}>
            {hasMoney ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={days} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="paidFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={PALETTE.lime} stopOpacity="0.22" />
                      <stop offset="1" stopColor={PALETTE.lime} stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="invoiceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={PALETTE.orange} stopOpacity="0.20" />
                      <stop offset="1" stopColor={PALETTE.orange} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={PALETTE.grid} />
                  <XAxis dataKey="date" tickFormatter={shortDate} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} minTickGap={34} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <YAxis tickFormatter={axisInr} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} width={64} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Area type="monotone" dataKey="invoicedPaise" name="Invoiced" stroke={PALETTE.orange} strokeWidth={2} fill="url(#invoiceFill)" />
                  <Area type="monotone" dataKey="paidPaise" name="Paid" stroke={PALETTE.lime} strokeWidth={2} fill="url(#paidFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Issue the first invoice to start the financial timeline." />}
          </div>
        </article>

        <article className="agency-chart-card client-chart-card">
          <header><div><span className="section-kicker">Client signal</span><h3>Activity by workspace</h3></div></header>
          <p className="chart-summary">Calls and audited operating events, grouped by client.</p>
          <div className="chart-canvas compact" role="img" aria-label="Client activity comparison chart">
            {hasActivity ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={comparison} layout="vertical" margin={{ top: 6, right: 10, left: 4, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={PALETTE.grid} />
                  <XAxis type="number" axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={92} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} tick={{ fill: PALETTE.axisCategory, fontSize: 11 }} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Bar dataKey="calls" name="Calls" stackId="a" fill={PALETTE.lime} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="activity" name="Activity" stackId="a" fill={PALETTE.orange} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Client calls and activity will appear here." />}
          </div>
        </article>

        <article className="agency-chart-card portfolio-chart-card">
          <header><div><span className="section-kicker">Portfolio</span><h3>Client lifecycle</h3></div></header>
          <p className="chart-summary">Active, onboarding, paused, and offboarded workspaces.</p>
          <div className="portfolio-body">
            <div className="portfolio-canvas" role="img" aria-label="Client lifecycle distribution">
              {portfolio.length ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart>
                    <Pie data={portfolio} dataKey="count" nameKey="status" innerRadius={50} outerRadius={72} paddingAngle={3} stroke="none">
                      {portfolio.map((row, index) => <Cell key={row.status} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="No clients yet." />}
            </div>
            <div className="portfolio-legend">
              {portfolio.map((row, index) => (
                <div key={row.status}><span style={{ background: COLORS[index % COLORS.length] }} />{row.status.replace('_', ' ')}<strong>{row.count}</strong></div>
              ))}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function axisCount(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function formatDuration(sec) {
  const total = Number(sec || 0);
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

function VoiceOverviewDashboard({ data, filters, onFilterChange }) {
  const kpis = data.kpis || {};
  const days = data.days || [];
  const outcomes = data.outcomes || [];
  const funnel = data.funnel || [];
  const spendSeries = data.spendSeries || [];
  const campaigns = data.campaigns || [];
  const hasCalls = Number(kpis.calls || 0) > 0;
  const filterFields = filters || {};

  const updateFilter = (key, value) => {
    if (typeof onFilterChange === 'function') onFilterChange({ ...filterFields, [key]: value });
  };

  return (
    <div className="agency-analytics voice-analytics" aria-label="Voice analytics">
      <section className="voice-filter-bar" aria-label="Voice analytics filters">
        <label>
          <span>From</span>
          <input type="date" value={filterFields.from || ''} onChange={(e) => updateFilter('from', e.target.value)} />
        </label>
        <label>
          <span>To</span>
          <input type="date" value={filterFields.to || ''} onChange={(e) => updateFilter('to', e.target.value)} />
        </label>
        <label>
          <span>Agent</span>
          <select value={filterFields.agentId || ''} onChange={(e) => updateFilter('agentId', e.target.value)}>
            <option value="">All agents</option>
            {(filterFields.agents || []).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <label>
          <span>Campaign</span>
          <select value={filterFields.campaignId || ''} onChange={(e) => updateFilter('campaignId', e.target.value)}>
            <option value="">All campaigns</option>
            {(filterFields.campaigns || []).map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
        <label>
          <span>Provider</span>
          <select value={filterFields.provider || ''} onChange={(e) => updateFilter('provider', e.target.value)}>
            <option value="">All providers</option>
            {(filterFields.providers || []).map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </label>
        <label>
          <span>Direction</span>
          <select value={filterFields.direction || ''} onChange={(e) => updateFilter('direction', e.target.value)}>
            <option value="">Both</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </label>
      </section>

      {data.dataMode === 'demo_seed' ? (
        <p className="chart-summary voice-demo-note">Demo analytics are shown because <code>demo=true</code> was requested. Live call runs replace this automatically.</p>
      ) : null}

      <section className="agency-metrics" aria-label="Voice metrics">
        <Metric label="Calls" value={kpis.calls} note="Tenant-scoped call runs" />
        <Metric label="Answered rate" value={Math.round(Number(kpis.answeredRate || 0))} note="Answered or completed outcomes" tone="positive" />
        <Metric label="Talk time" value={kpis.durationSec} note={formatDuration(kpis.durationSec)} />
        <Metric label="AI runtime spend" value={kpis.aiSpendPaise} money note="Estimated AI layer only" tone="warning" />
        <Metric label="Campaigns touched" value={kpis.campaigns} note={`${outcomes.length} outcome types`} />
      </section>

      <section className="agency-chart-grid voice-chart-grid">
        <article className="agency-chart-card">
          <header><div><span className="section-kicker">Volume</span><h3>Calls over time</h3></div></header>
          <div className="chart-canvas" role="img" aria-label="Calls area chart">
            {hasCalls ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <AreaChart data={days} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={PALETTE.blue} stopOpacity="0.22" />
                      <stop offset="1" stopColor={PALETTE.blue} stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id="answeredFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={PALETTE.lime} stopOpacity="0.24" />
                      <stop offset="1" stopColor={PALETTE.lime} stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke={PALETTE.grid} />
                  <XAxis dataKey="date" tickFormatter={shortDate} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} minTickGap={34} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <YAxis tickFormatter={axisCount} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} width={48} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <Tooltip content={<CountTooltip />} />
                  <Area type="monotone" dataKey="calls" name="Calls" stroke={PALETTE.blue} strokeWidth={2} fill="url(#callsFill)" />
                  <Area type="monotone" dataKey="answered" name="Answered" stroke={PALETTE.lime} strokeWidth={2} fill="url(#answeredFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="No call runs yet. Place a test call or start Talk to it to populate analytics." />}
          </div>
        </article>

        <article className="agency-chart-card">
          <header><div><span className="section-kicker">Outcomes</span><h3>Call results</h3></div></header>
          <div className="chart-canvas compact" role="img" aria-label="Outcome bar chart">
            {outcomes.length ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={outcomes} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={PALETTE.grid} />
                  <XAxis dataKey="outcome" axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <YAxis tickFormatter={axisCount} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} width={48} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <Tooltip content={<CountTooltip />} />
                  <Bar dataKey="count" name="Calls" fill={PALETTE.lime} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Outcome distribution appears after the first completed call run." />}
          </div>
        </article>

        <article className="agency-chart-card">
          <header><div><span className="section-kicker">Spend</span><h3>AI runtime trend</h3></div></header>
          <div className="chart-canvas compact" role="img" aria-label="AI spend line chart">
            {spendSeries.some((row) => row.aiSpendPaise) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <LineChart data={spendSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={PALETTE.grid} />
                  <XAxis dataKey="date" tickFormatter={shortDate} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} minTickGap={34} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <YAxis tickFormatter={axisInr} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} width={64} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <Tooltip content={<MoneyTooltip />} />
                  <Line type="monotone" dataKey="aiSpendPaise" name="AI spend" stroke={PALETTE.orange} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="AI spend tracking starts when call runs record runtime usage." />}
          </div>
        </article>

        <article className="agency-chart-card">
          <header><div><span className="section-kicker">Funnel</span><h3>Call progression</h3></div></header>
          <div className="chart-canvas compact" role="img" aria-label="Call funnel chart">
            {funnel.some((row) => row.count > 0) ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <BarChart data={funnel} layout="vertical" margin={{ top: 6, right: 10, left: 4, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke={PALETTE.grid} />
                  <XAxis type="number" axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} tick={{ fill: PALETTE.axis, fontSize: 11 }} />
                  <YAxis type="category" dataKey="stage" width={92} axisLine={{ stroke: PALETTE.axisLine }} tickLine={false} tick={{ fill: PALETTE.axisCategory, fontSize: 11 }} />
                  <Tooltip content={<CountTooltip />} />
                  <Bar dataKey="count" name="Calls" fill={PALETTE.lime} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyChart text="Funnel stages populate once calls move beyond the first dial attempt." />}
          </div>
        </article>

        <article className="agency-chart-card portfolio-chart-card">
          <header><div><span className="section-kicker">Campaigns</span><h3>Calls by campaign</h3></div></header>
          <div className="portfolio-body">
            <div className="portfolio-canvas" role="img" aria-label="Campaign distribution chart">
              {campaigns.some((row) => row.calls > 0) ? (
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <PieChart>
                    <Pie data={campaigns.filter((row) => row.calls > 0)} dataKey="calls" nameKey="name" innerRadius={50} outerRadius={72} paddingAngle={3} stroke="none">
                      {campaigns.filter((row) => row.calls > 0).map((row, index) => <Cell key={row.id} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <EmptyChart text="Campaign analytics appear when call runs include a campaign." />}
            </div>
            <div className="portfolio-legend">
              {campaigns.map((row, index) => (
                <div key={row.id}><span style={{ background: COLORS[index % COLORS.length] }} />{row.name}<strong>{row.calls}</strong></div>
              ))}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

function mountVoiceOverview(host, data, filters, onFilterChange) {
  if (!host) return;
  let root = roots.get(host);
  if (!root) { root = createRoot(host); roots.set(host, root); }
  root.render(<VoiceOverviewDashboard data={data || {}} filters={filters} onFilterChange={onFilterChange} />);
}

function mountAgencyDashboard(host, data) {
  if (!host) return;
  let root = roots.get(host);
  if (!root) { root = createRoot(host); roots.set(host, root); }
  root.render(<AgencyDashboard data={data || {}} />);
}

function unmount(host) {
  const root = roots.get(host);
  if (root) { root.unmount(); roots.delete(host); }
}

const chartExports = { mountAgencyDashboard, mountVoiceOverview, unmount };
window.VaaniCharts = chartExports;
