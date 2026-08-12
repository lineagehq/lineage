import { useEffect, useState, type FormEvent } from 'react';
import type { AssetLibrarySnapshot, GrowthAsset, LineageWorkspace } from '../../shared/types';
import { api } from '../api';
import { lineageAssetSearchPath, lineageCreateWorkspaceBody, lineageDefaultWorkspaceTitle } from './lineageNewWorkspaceModel';
import './LineageNewWorkspaceModal.css';

function storageLabel(asset: GrowthAsset): string {
  if (asset.local?.relative_path && asset.s3?.key) return 'local + S3';
  if (asset.local?.relative_path) return 'local only';
  if (asset.s3?.key) return 'S3 backed';
  return asset.source || 'catalog';
}

export function LineageNewWorkspaceModal({
  onClose,
  onCreated,
  onToast,
  open,
  project,
}: {
  onClose: () => void;
  onCreated: (workspace: LineageWorkspace) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  open: boolean;
  project: string;
}) {
  const [assets, setAssets] = useState<GrowthAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [query, setQuery] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<GrowthAsset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api<AssetLibrarySnapshot>(lineageAssetSearchPath(project, query))
        .then(snapshot => {
          if (active) setAssets(snapshot.assets);
        })
        .catch(error => {
          if (active) onToast('error', error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [onToast, open, project, query]);

  useEffect(() => {
    if (selectedAsset) setTitle(lineageDefaultWorkspaceTitle(selectedAsset));
  }, [selectedAsset]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedAsset || !title.trim()) return;
    setSubmitting(true);
    try {
      const result = await api<{ workspace: LineageWorkspace }>('/api/lineage-workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lineageCreateWorkspaceBody(project, selectedAsset, title, notes)),
      });
      onCreated(result.workspace);
    } catch (error) {
      onToast('error', error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="lineage-new-backdrop" role="presentation">
      <form aria-label="New lineage" className="lineage-new-modal" onSubmit={event => void submit(event)}>
        <header>
          <div>
            <h3>New lineage</h3>
            <p>Choose the asset that starts this iteration tree.</p>
          </div>
          <button aria-label="Close new lineage" className="icon-button" onClick={onClose} type="button">×</button>
        </header>
        <label className="lineage-new-search">
          <span>Root asset</span>
          <input autoFocus onChange={event => setQuery(event.target.value)} placeholder="Search by title, id, campaign, channel..." value={query} />
        </label>
        <div className="lineage-new-results" role="listbox">
          {assets.map(asset => (
            <button
              aria-selected={selectedAsset?.asset_id === asset.asset_id}
              className={selectedAsset?.asset_id === asset.asset_id ? 'selected' : ''}
              key={asset.asset_id}
              onClick={() => setSelectedAsset(asset)}
              type="button"
            >
              <strong>{asset.title}</strong>
              <code>{asset.asset_id}</code>
              <span>{asset.channel} · {asset.content_type} · {storageLabel(asset)}</span>
            </button>
          ))}
          {loading && <p>Searching...</p>}
          {!loading && assets.length === 0 && <p>No matching assets found.</p>}
        </div>
        <label className="lineage-new-field">
          <span>Name</span>
          <input disabled={!selectedAsset} onChange={event => setTitle(event.target.value)} value={title} />
        </label>
        <label className="lineage-new-field">
          <span>Notes</span>
          <textarea onChange={event => setNotes(event.target.value)} placeholder="Optional context for future agents" value={notes} />
        </label>
        <footer>
          <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
          <button className="primary-button" disabled={!selectedAsset || !title.trim() || submitting} type="submit">
            {submitting ? 'Creating...' : 'Create lineage'}
          </button>
        </footer>
      </form>
    </div>
  );
}
