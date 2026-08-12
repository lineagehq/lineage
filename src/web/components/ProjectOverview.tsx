import {
  Archive,
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  Grid2X2,
  List,
  Network,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LineageWorkspace } from '../../shared/lineageWorkspaceTypes';
import type {
  CollectionSort,
  WorkspaceCollectionKind,
  WorkspaceCollectionSnapshot,
} from '../../shared/projectWorkspaceTypes';
import { api } from '../api';
import {
  WORKSPACES_PRESENTATION_KEY,
  readCollectionPresentation,
  writeCollectionPresentation,
} from '../navigationPreferences';
import { OrderedCollection, type CollectionPresentation } from './OrderedCollection';
import {
  DeleteWorkspaceDialog,
  WorkspaceStatusDialog,
} from './WorkspaceLifecycleDialogs';
import './ProjectsView.css';
import './ProjectOverview.css';

type WorkspaceDialogState =
  | { action: 'archive' | 'restore' | 'delete'; workspace: LineageWorkspace }
  | null;

export function ProjectOverview(props: {
  onAllProjects: () => void;
  onNewWorkspace: (project: string) => void;
  onOpenCanvas: (project: string, workspace: LineageWorkspace) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
  onWorkspaceInvalidated: (workspaceId: string) => void;
  projectId: string;
}) {
  const [snapshot, setSnapshot] = useState<WorkspaceCollectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CollectionSort>('manual');
  const [collection, setCollection] = useState<WorkspaceCollectionKind>('open');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [presentation, setPresentation] = useState<CollectionPresentation>(() => readCollectionPresentation(WORKSPACES_PRESENTATION_KEY));
  const [dialog, setDialog] = useState<WorkspaceDialogState>(null);
  const dialogReturnRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const openTabRef = useRef<HTMLButtonElement | null>(null);
  const archivedTabRef = useRef<HTMLButtonElement | null>(null);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        collection,
        page: String(page),
        pageSize: String(pageSize),
        sort,
      });
      if (query.trim()) params.set('q', query.trim());
      const result = await api<WorkspaceCollectionSnapshot>(
        `/api/projects/${encodeURIComponent(props.projectId)}/workspaces?${params.toString()}`
      );
      if (generation !== loadGenerationRef.current) return;
      setSnapshot(result);
      if (result.pagination.totalPages > 0 && page > result.pagination.totalPages) {
        setPage(result.pagination.totalPages);
      }
    } catch (nextError) {
      if (generation !== loadGenerationRef.current) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [collection, page, pageSize, props.projectId, query, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    loadGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    setPage(1);
  }, [collection, pageSize, query, sort]);

  function changePresentation(next: CollectionPresentation) {
    setPresentation(next);
    writeCollectionPresentation(WORKSPACES_PRESENTATION_KEY, next);
  }

  function openDialog(action: 'archive' | 'restore' | 'delete', workspace: LineageWorkspace, target: HTMLElement) {
    dialogReturnRef.current = target;
    setDialog({ action, workspace });
  }

  async function moveWorkspace(itemId: string, targetIndex: number) {
    if (!snapshot) return;
    try {
      await api(`/api/projects/${encodeURIComponent(props.projectId)}/workspaces/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection,
          itemId,
          targetIndex,
          expectedRevision: snapshot.manual_revision,
          confirmWrite: true,
        }),
      });
      await load();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      props.onToast('error', message);
      await load();
      throw nextError;
    }
  }

  async function lifecycleDone(message: string, invalidatedWorkspace?: LineageWorkspace) {
    if (invalidatedWorkspace) props.onWorkspaceInvalidated(invalidatedWorkspace.id);
    props.onToast('ok', message);
    await load();
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  function selectCollection(next: WorkspaceCollectionKind, focus = false) {
    setCollection(next);
    if (focus) (next === 'open' ? openTabRef.current : archivedTabRef.current)?.focus();
  }

  function onLifecycleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' || event.key === 'ArrowLeft' ? 'open' : 'archived';
    selectCollection(next, true);
  }

  const reorderEnabled = Boolean(snapshot?.reorder_enabled && sort === 'manual' && !query.trim());
  const reorderDisabledReason = reorderEnabled
    ? undefined
    : 'Reorder is available in Manual sort with no search filter. Open and archived workspaces always keep separate orders.';

  return (
    <section aria-labelledby="project-workspaces-title" className="organization-page project-overview-page">
      <nav aria-label="Breadcrumb" className="project-breadcrumb">
        <button onClick={props.onAllProjects} type="button"><ArrowLeft aria-hidden="true" size={16} />All projects</button>
      </nav>
      <header className="organization-hero project-overview-hero">
        <div>
          <span className="organization-eyebrow">{snapshot?.project.display_name || props.projectId}</span>
          <h1 id="project-workspaces-title" ref={headingRef} tabIndex={-1}>Workspaces</h1>
          <p>Choose a workspace to open its canvas, or organize the collection before diving in.</p>
        </div>
        <button className="primary-button organization-primary-action" onClick={() => props.onNewWorkspace(props.projectId)} type="button">
          <Plus size={17} />New workspace
        </button>
      </header>

      <div className="workspace-lifecycle-tabs" role="tablist" aria-label="Workspace lifecycle">
        <button
          aria-controls="workspace-collection-panel"
          aria-selected={collection === 'open'}
          id="workspace-open-tab"
          onClick={() => selectCollection('open')}
          onKeyDown={onLifecycleKeyDown}
          ref={openTabRef}
          role="tab"
          tabIndex={collection === 'open' ? 0 : -1}
          type="button"
        >
          Open
        </button>
        <button
          aria-controls="workspace-collection-panel"
          aria-selected={collection === 'archived'}
          id="workspace-archived-tab"
          onClick={() => selectCollection('archived')}
          onKeyDown={onLifecycleKeyDown}
          ref={archivedTabRef}
          role="tab"
          tabIndex={collection === 'archived' ? 0 : -1}
          type="button"
        >
          Archived
        </button>
      </div>

      <div className="organization-toolbar">
        <label className="organization-search">
          <span className="sr-only">Search workspaces</span>
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search workspaces"
            onChange={event => setQuery(event.target.value)}
            placeholder={`Search ${collection} workspaces`}
            type="search"
            value={query}
          />
        </label>
        <label className="organization-sort">
          <span>Sort</span>
          <select aria-label="Sort workspaces" onChange={event => setSort(event.target.value as CollectionSort)} value={sort}>
            <option value="manual">Manual order</option>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
        </label>
        <div aria-label="Workspace presentation" className="organization-view-toggle" role="group">
          <button aria-label="Show workspaces as cards" aria-pressed={presentation === 'cards'} onClick={() => changePresentation('cards')} type="button"><Grid2X2 size={17} /></button>
          <button aria-label="Show workspaces as a list" aria-pressed={presentation === 'list'} onClick={() => changePresentation('list')} type="button"><List size={18} /></button>
        </div>
      </div>

      <div className="organization-collection-status" aria-live="polite">
        <span>{snapshot ? `${snapshot.pagination.total} ${collection} workspace${snapshot.pagination.total === 1 ? '' : 's'}` : 'Workspaces'}</span>
        {loading && <span role="status">Updating…</span>}
      </div>

      <div
        aria-labelledby={`workspace-${collection}-tab`}
        id="workspace-collection-panel"
        role="tabpanel"
      >
      {error ? (
        <div className="organization-state organization-state-error" role="alert">
          <strong>This project could not be loaded.</strong>
          <p>{error}</p>
          <div className="organization-state-actions">
            <button className="secondary-button" onClick={props.onAllProjects} type="button">All projects</button>
            <button className="primary-button" onClick={() => void load()} type="button">Try again</button>
          </div>
        </div>
      ) : loading && !snapshot ? (
        <div className="organization-skeletons" aria-label="Loading workspaces" role="status">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
      ) : (
        <OrderedCollection
          ariaLabel={`${collection === 'open' ? 'Open' : 'Archived'} workspaces`}
          empty={
            <div className="organization-empty-copy">
              <Network aria-hidden="true" size={32} />
              <strong>{query ? 'No workspaces match that search' : collection === 'archived' ? 'No archived workspaces' : 'Create your first workspace'}</strong>
              <p>{query ? 'Try a different name or clear the search.' : collection === 'archived' ? 'Archived workspaces will appear here for safe restoration.' : 'A workspace gives a lineage graph its own focused canvas.'}</p>
              {!query && collection === 'open' && <button className="primary-button" onClick={() => props.onNewWorkspace(props.projectId)} type="button"><Plus size={16} />New workspace</button>}
            </div>
          }
          itemId={item => item.id}
          itemLabel={item => item.title}
          items={snapshot?.workspaces || []}
          onMove={moveWorkspace}
          onOpen={collection === 'open'
            ? workspace => props.onOpenCanvas(props.projectId, workspace)
            : undefined}
          page={snapshot?.pagination.page || page}
          pageSize={snapshot?.pagination.pageSize || pageSize}
          presentation={presentation}
          renderItem={workspace => (
            <WorkspaceItem
              collection={collection}
              onDelete={event => openDialog('delete', workspace, event.currentTarget)}
              onOpen={() => props.onOpenCanvas(props.projectId, workspace)}
              onStatus={event => openDialog(collection === 'archived' ? 'restore' : 'archive', workspace, event.currentTarget)}
              workspace={workspace}
            />
          )}
          reorderDisabledReason={reorderDisabledReason}
          reorderEnabled={reorderEnabled}
          total={snapshot?.pagination.total || 0}
        />
      )}
      </div>

      {snapshot && snapshot.pagination.totalPages > 1 && (
        <footer className="organization-pagination" aria-label="Workspaces pagination">
          <button className="secondary-button" disabled={snapshot.pagination.page <= 1} onClick={() => setPage(value => value - 1)} type="button">Previous</button>
          <span>Page {snapshot.pagination.page} of {snapshot.pagination.totalPages}</span>
          <button className="secondary-button" disabled={snapshot.pagination.page >= snapshot.pagination.totalPages} onClick={() => setPage(value => value + 1)} type="button">Next</button>
          <label>
            Per page
            <select aria-label="Workspaces per page" onChange={event => setPageSize(Number(event.target.value))} value={pageSize}>
              {[6, 12, 24].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </footer>
      )}

      {dialog?.action === 'delete' && (
        <DeleteWorkspaceDialog
          onClose={() => setDialog(null)}
          onDeleted={message => void lifecycleDone(message, dialog.workspace)}
          project={props.projectId}
          returnFocusRef={dialogReturnRef}
          workspace={dialog.workspace}
        />
      )}
      {(dialog?.action === 'archive' || dialog?.action === 'restore') && (
        <WorkspaceStatusDialog
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={message => void lifecycleDone(
            message,
            dialog.action === 'archive' ? dialog.workspace : undefined,
          )}
          project={props.projectId}
          returnFocusRef={dialogReturnRef}
          workspace={dialog.workspace}
        />
      )}
    </section>
  );
}

function WorkspaceItem(props: {
  collection: WorkspaceCollectionKind;
  onDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  onStatus: (event: React.MouseEvent<HTMLButtonElement>) => void;
  workspace: LineageWorkspace;
}) {
  const updated = new Date(props.workspace.updated_at);
  return (
    <div className="organization-item workspace-organization-item">
      <div className="organization-item-symbol"><Network aria-hidden="true" size={22} /></div>
      <div className="organization-item-copy">
        <div>
          <span className={`workspace-status workspace-status-${props.workspace.status}`}>{props.workspace.status}</span>
          <h2>{props.workspace.title}</h2>
          <p className="workspace-secondary-id">{props.workspace.id}</p>
        </div>
        <dl className="organization-item-stats">
          <div><dt><CalendarClock size={14} />Updated</dt><dd>{Number.isNaN(updated.getTime()) ? 'Unknown' : updated.toLocaleDateString()}</dd></div>
          <div><dt>Created by</dt><dd>{props.workspace.created_by}</dd></div>
        </dl>
      </div>
      <footer className="organization-item-actions workspace-item-actions">
        <div>
          <button className="secondary-button" onClick={props.onStatus} type="button">
            {props.collection === 'archived' ? <RotateCcw size={15} /> : <Archive size={15} />}
            {props.collection === 'archived' ? 'Restore' : 'Archive'}
          </button>
          <button className="secondary-button organization-delete-action" onClick={props.onDelete} type="button"><Trash2 size={15} />Delete</button>
        </div>
        {props.collection === 'open' && (
          <button className="primary-button" onClick={props.onOpen} type="button">Open Canvas<ExternalLink size={15} /></button>
        )}
      </footer>
    </div>
  );
}
