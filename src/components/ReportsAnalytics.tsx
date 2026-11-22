import React, { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays, Lightbulb, TrendingUp } from 'lucide-react';
import { BUSINESS_UNITS } from '../lib/seedData';
import { BusinessId, TransactionRecord } from '../types/erp';

interface Props {
  transactions: TransactionRecord[];
  initialBusiness: BusinessId | 'ALL';
  allowedBusinessIds: BusinessId[];
}

interface ChartSeries {
  name: string;
  color: string;
  values: number[];
}

const COLORS: Record<BusinessId, string> = {
  real_estate: '#0b7a5a',
  pickleball: '#d8a72d',
  jewelry: '#8b5cf6',
};

const money = (amount: number) => `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`;
const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

function LineChart({ labels, series, currency = true }: { labels: string[]; series: ChartSeries[]; currency?: boolean }) {
  const width = 720;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 38, left: 62 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
  const tickStep = maxValue / 4;
  const pointX = (index: number) => padding.left + (labels.length < 2 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const pointY = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  if (!labels.length || !series.length) {
    return <div className="flex h-[260px] items-center justify-center text-sm text-slate-500">Not enough transaction history for this chart.</div>;
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Trend chart" className="h-[260px] min-w-[560px] w-full">
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = tickStep * tick;
          const y = pointY(value);
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={tick === 0 ? undefined : '3 4'} />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-slate-500" fontSize="10">
                {currency ? money(value) : Math.round(value)}
              </text>
            </g>
          );
        })}
        {labels.map((label, index) => (
          (index % labelStep === 0 || index === labels.length - 1) && (
            <text key={`${label}-${index}`} x={pointX(index)} y={height - 12} textAnchor="middle" className="fill-slate-500" fontSize="10">
              {label}
            </text>
          )
        ))}
        {series.map((item) => {
          const points = item.values.map((value, index) => `${pointX(index)},${pointY(value)}`).join(' ');
          return (
            <g key={item.name}>
              {item.values.length > 1 && <polyline points={points} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
              {item.values.map((value, index) => (
                <circle key={`${item.name}-${index}`} cx={pointX(index)} cy={pointY(value)} r="3" fill="white" stroke={item.color} strokeWidth="2">
                  <title>{`${item.name}: ${currency ? money(value) : value}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {series.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  );
}

export const ReportsAnalytics: React.FC<Props> = ({ transactions, initialBusiness, allowedBusinessIds }) => {
  const [businessScope, setBusinessScope] = useState<BusinessId | 'ALL'>(
    initialBusiness === 'ALL' && allowedBusinessIds.length === 1 ? allowedBusinessIds[0] : initialBusiness
  );
  const businessOptions = BUSINESS_UNITS.filter((unit) => allowedBusinessIds.includes(unit.id));
  const filteredTransactions = useMemo(
    () => transactions.filter((tx) => businessScope === 'ALL' || tx.businessId === businessScope),
    [transactions, businessScope]
  );
  const approvedTransactions = useMemo(
    () => filteredTransactions.filter((tx) => tx.status === 'APPROVED'),
    [filteredTransactions]
  );
  const now = new Date();
  const dailyLabels = useMemo(() => Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29 + index));
    return { key: dayKey(date), label: `${date.getUTCDate()} ${date.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}` };
  }), []);
  const monthlyLabels = useMemo(() => Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    return { key: monthKey(date), label: date.toLocaleString('en', { month: 'short', year: '2-digit', timeZone: 'UTC' }) };
  }), []);
  const scopeBusinesses = businessScope === 'ALL'
    ? businessOptions
    : businessOptions.filter((unit) => unit.id === businessScope);

  const dailyRevenueSeries = scopeBusinesses.map((unit) => ({
    name: unit.name.replace('JAST ', ''),
    color: COLORS[unit.id],
    values: dailyLabels.map(({ key }) => approvedTransactions
      .filter((tx) => tx.businessId === unit.id && tx.txType === 'INCOME' && tx.txDate === key)
      .reduce((sum, tx) => sum + tx.amount, 0)),
  }));
  const dailyTransactionSeries = scopeBusinesses.map((unit) => ({
    name: unit.name.replace('JAST ', ''),
    color: COLORS[unit.id],
    values: dailyLabels.map(({ key }) =>
      approvedTransactions.filter((tx) => tx.businessId === unit.id && tx.txDate === key).length
    ),
  }));
  const monthlyRevenueSeries = scopeBusinesses.map((unit) => ({
    name: unit.name.replace('JAST ', ''),
    color: COLORS[unit.id],
    values: monthlyLabels.map(({ key }) => approvedTransactions
      .filter((tx) => tx.businessId === unit.id && tx.txType === 'INCOME' && tx.txDate.slice(0, 7) === key)
      .reduce((sum, tx) => sum + tx.amount, 0)),
  }));
  const monthlyExpenseSeries = scopeBusinesses.map((unit) => ({
    name: unit.name.replace('JAST ', ''),
    color: COLORS[unit.id],
    values: monthlyLabels.map(({ key }) => approvedTransactions
      .filter((tx) => tx.businessId === unit.id && tx.txType !== 'INCOME' && tx.txDate.slice(0, 7) === key)
      .reduce((sum, tx) => sum + tx.amount, 0)),
  }));
  const monthlyTransactionSeries = scopeBusinesses.map((unit) => ({
    name: unit.name.replace('JAST ', ''),
    color: COLORS[unit.id],
    values: monthlyLabels.map(({ key }) => approvedTransactions
      .filter((tx) => tx.businessId === unit.id && tx.txDate.slice(0, 7) === key).length),
  }));

  const summary = approvedTransactions.reduce((totals, tx) => {
    if (tx.txType === 'INCOME') totals.revenue += tx.amount;
    else totals.expenses += tx.amount;
    return totals;
  }, { revenue: 0, expenses: 0 });
  const averageTransaction = approvedTransactions.length ? summary.revenue / approvedTransactions.filter((tx) => tx.txType === 'INCOME').length : 0;
  const categoryRevenue = Object.entries(approvedTransactions.reduce<Record<string, number>>((totals, tx) => {
    if (tx.txType === 'INCOME') totals[tx.category] = (totals[tx.category] || 0) + tx.amount;
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxCategoryRevenue = Math.max(1, ...categoryRevenue.map(([, amount]) => amount));
  const selectedMonthlyRevenue = monthlyLabels.slice(0, -1).map(({ key }) =>
    approvedTransactions
      .filter((tx) => tx.txType === 'INCOME' && tx.txDate.slice(0, 7) === key)
      .reduce((sum, tx) => sum + tx.amount, 0)
  );
  const completedMonthsWithRevenue = monthlyLabels.slice(0, -1).filter(({ key }) =>
    approvedTransactions.some((tx) => tx.txType === 'INCOME' && tx.txDate.slice(0, 7) === key)
  ).length;
  const forecast = useMemo(() => {
    if (completedMonthsWithRevenue < 3) return [];
    const observed = selectedMonthlyRevenue.slice(-6);
    const n = observed.length;
    const meanX = (n - 1) / 2;
    const meanY = observed.reduce((sum, value) => sum + value, 0) / n;
    const denominator = observed.reduce((sum, _value, index) => sum + (index - meanX) ** 2, 0);
    const slope = denominator
      ? observed.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0) / denominator
      : 0;
    return [1, 2, 3].map((step) => Math.max(0, meanY + slope * (n - 1 + step)));
  }, [completedMonthsWithRevenue, selectedMonthlyRevenue]);
  const completedMonths = monthlyLabels.slice(0, -1);
  const lowestRevenueMonth = completedMonths
    .map((month, index) => ({ ...month, revenue: monthlyRevenueSeries.reduce((sum, unit) => sum + unit.values[index], 0) }))
    .filter((month) => month.revenue > 0)
    .sort((a, b) => a.revenue - b.revenue)[0];
  const highestRevenueMonth = completedMonths
    .map((month, index) => ({ ...month, revenue: monthlyRevenueSeries.reduce((sum, unit) => sum + unit.values[index], 0) }))
    .sort((a, b) => b.revenue - a.revenue)[0];
  const scopeLabel = businessScope === 'ALL'
    ? 'All authorized businesses'
    : businessOptions.find((unit) => unit.id === businessScope)?.name || 'Selected business';

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Reports & Analytics</h2>
          <p className="mt-1 text-xs text-slate-500">Historical performance and planning signals from approved ledger transactions.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          Business scope
          <select
            value={businessScope}
            onChange={(event) => setBusinessScope(event.target.value as BusinessId | 'ALL')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          >
            {businessOptions.length > 1 && <option value="ALL">All authorized businesses</option>}
            {businessOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { title: 'Approved revenue', value: money(summary.revenue), icon: TrendingUp, color: 'text-emerald-700 bg-emerald-50' },
          { title: 'Approved expenses', value: money(summary.expenses), icon: ArrowDownRight, color: 'text-orange-700 bg-orange-50' },
          { title: 'Net operating result', value: money(summary.revenue - summary.expenses), icon: BarChart3, color: 'text-blue-700 bg-blue-50' },
          { title: 'Average income transaction', value: money(averageTransaction), icon: ArrowUpRight, color: 'text-violet-700 bg-violet-50' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${item.color}`}><Icon className="h-5 w-5" /></div>
              <div><p className="text-[11px] text-slate-500">{item.title}</p><p className="text-lg font-bold text-slate-900">{item.value}</p></div>
            </div>
          );
        })}
      </div>

      {approvedTransactions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-3 font-semibold text-slate-800">No approved transactions in this scope yet</h3>
          <p className="mt-1 text-sm text-slate-500">Charts will populate as approved transactions are added to the ledger.</p>
        </div>
      ) : (
        <>
          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-slate-800">Monthly revenue trend</h3>
                <p className="text-[11px] text-slate-500">Last 12 calendar months (current month to date) · {scopeLabel}</p>
              </div>
              <LineChart labels={monthlyLabels.map((month) => month.label)} series={monthlyRevenueSeries} />
              <Legend series={monthlyRevenueSeries} />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-slate-800">Monthly expense trend</h3>
                <p className="text-[11px] text-slate-500">Approved outflows · last 12 months</p>
              </div>
              <LineChart labels={monthlyLabels.map((month) => month.label)} series={monthlyExpenseSeries} />
              <Legend series={monthlyExpenseSeries} />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-slate-800">Daily revenue trend</h3>
                <p className="text-[11px] text-slate-500">Last 30 days · {scopeLabel}</p>
              </div>
              <LineChart labels={dailyLabels.map((day) => day.label)} series={dailyRevenueSeries} />
              <Legend series={dailyRevenueSeries} />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-slate-800">Daily transaction volume</h3>
                <p className="text-[11px] text-slate-500">Approved ledger entries · last 30 days</p>
              </div>
              <LineChart labels={dailyLabels.map((day) => day.label)} series={dailyTransactionSeries} currency={false} />
              <Legend series={dailyTransactionSeries} />
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-slate-800">Monthly transaction volume</h3>
                <p className="text-[11px] text-slate-500">Approved ledger entries · last 12 months</p>
              </div>
              <LineChart labels={monthlyLabels.map((month) => month.label)} series={monthlyTransactionSeries} currency={false} />
              <Legend series={monthlyTransactionSeries} />
            </article>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-[#075b43]" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Revenue by category</h3>
                  <p className="text-[11px] text-slate-500">Approved income · {scopeLabel}</p>
                </div>
              </div>
              {categoryRevenue.length ? (
                <div className="space-y-3">
                  {categoryRevenue.map(([category, amount]) => (
                    <div key={category}>
                      <div className="mb-1 flex justify-between gap-3 text-xs">
                        <span className="truncate text-slate-600">{category}</span>
                        <span className="shrink-0 font-semibold text-slate-800">{money(amount)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-[#0b7a5a]" style={{ width: `${(amount / maxCategoryRevenue) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="py-8 text-center text-sm text-slate-500">No approved income categories to compare.</p>}
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-start gap-2">
                <Lightbulb className="mt-0.5 h-4 w-4 text-amber-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Planning signals</h3>
                  <p className="text-[11px] text-slate-500">Use these patterns to review scheduling and promotions.</p>
                </div>
              </div>
              <div className="space-y-3 text-xs">
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
                  Strongest completed month in the displayed period: <strong>{highestRevenueMonth?.label} ({money(highestRevenueMonth?.revenue || 0)})</strong>.
                </p>
                {lowestRevenueMonth ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
                    Lowest completed month with recorded income: <strong>{lowestRevenueMonth.label} ({money(lowestRevenueMonth.revenue)})</strong>. Compare its business activity and categories with stronger periods before planning.
                  </p>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">A low month cannot be identified until revenue is recorded.</p>
                )}
                {forecast.length ? (
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-950">
                    Directional 3-month revenue estimate from a linear trend of up to six completed months: <strong>{money(forecast[0])}, {money(forecast[1])}, {money(forecast[2])}</strong>.
                  </p>
                ) : (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">Forecast unavailable: at least three completed months with approved income are needed.</p>
                )}
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
                Estimates are directional, based only on recorded transactions. They do not account for seasonality, one-time events, costs, or future business changes.
              </p>
            </article>
          </section>
        </>
      )}
    </div>
  );
};
