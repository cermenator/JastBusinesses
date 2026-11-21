import React, { useEffect, useState } from 'react';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import {
  getLegacyDataStatus,
  LegacyDataStatus,
  migrateLegacyBrowserData,
  MigrationSummary,
} from '../lib/localDataMigration';

interface Props {
  userId: string;
  userName: string;
  onComplete: () => void;
}

export const LegacyDataImport: React.FC<Props> = ({ userId, userName, onComplete }) => {
  const [status, setStatus] = useState<LegacyDataStatus>(() => getLegacyDataStatus(userId));
  const [summary, setSummary] = useState<MigrationSummary | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    setStatus(getLegacyDataStatus(userId));
  }, [userId]);

  if (!status.available && !status.error) return null;

  const importData = async () => {
    setImporting(true);
    setError('');
    try {
      const imported = await migrateLegacyBrowserData(userId, userName);
      setSummary(imported);
      setStatus({ available: true, complete: true });
      onComplete();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'The local data import failed.');
    } finally {
      setImporting(false);
    }
  };

  if (status.complete) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <h2 className="font-semibold">Browser data import complete</h2>
        {summary && (
          <p className="mt-1">
            Imported or matched {summary.properties} properties, {summary.jewelry} jewelry items, {summary.courts} courts,
            {` ${summary.propertyBookings} property bookings, ${summary.bookings} court bookings, ${summary.sales} sales, and ${summary.transactions} ledger transactions.`}
          </p>
        )}
        {summary && <p className="mt-2 text-xs">{summary.auditHistoryNote}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <h2 className="font-semibold">Older browser-local records found</h2>
          <p className="mt-1">
            You confirmed importing earlier records. This one-time import preserves the browser copy, keeps exact transaction references,
            and links uploaded photos to private Supabase Storage. It requires the Jasmin owner account.
          </p>
        </div>
      </div>
      {status.error && <p role="alert" className="text-sm text-rose-800">{status.error}</p>}
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      <button
        type="button"
        disabled={importing || Boolean(status.error)}
        onClick={() => { void importData(); }}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 disabled:cursor-wait disabled:opacity-60"
      >
        {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
        {importing ? 'Importing to Supabase...' : 'Import saved browser data'}
      </button>
    </section>
  );
};
