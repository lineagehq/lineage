import {
  FolderKanban,
  Grid2X2,
  Image,
  List,
  Network,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CollectionSort,
  ProjectCollectionSnapshot,
  ProjectWorkspaceSummary,
} from '../../shared/projectWorkspaceTypes';
import { api } from '../api';
import {
  PROJECTS_PRESENTATION_KEY,
  readCollectionPresentation,
  writeCollectionPresentation,
} from '../navigationPreferences';
import {
  OrderedCollection,
  type CollectionPresentation,
} from './OrderedCollection';
import {
  CreateProjectDialog,
  DeleteProjectDialog,
} from './ProjectLifecycleDialogs';
import './ProjectsView.css';

export function ProjectsView(props: {
  onOpenProject: (project: ProjectWorkspaceSummary) => void;
  onProjectDeleted: (projectId: string) => void;
  onToast: (type: 'ok' | 'error', message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<ProjectCollectionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CollectionSort>('manual');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [presentation, setPresentation] = useState<CollectionPresentation>(() => readCollectionPresentation(PROJECTS_PRESENTATION_KEY));
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteProject, setDeleteProject] = useState<ProjectWorkspaceSummary | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteButtonRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const preservePageOnFilterResetRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
      });
      if (query.trim()) params.set('q', query.trim());
      const result = await api<ProjectCollectionSnapshot>(`/api/projects?${params.toString()}`);
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
  }, [page, pageSize, query, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    loadGenerationRef.current += 1;
  }, []);

  useEffect(() => {
    if (preservePageOnFilterResetRef.current) {
      preservePageOnFilterResetRef.current = false;
      return;
    }
    setPage(1);
  }, [pageSize, query, sort]);

  function changePresentation(next: CollectionPresentation) {
    setPresentation(next);
    writeCollectionPresentation(PROJECTS_PRESENTATION_KEY, next);
  }

  async function moveProject(itemId: string, targetIndex: number) {
    if (!snapshot) return;
    try {
      await api('/api/projects/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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

  async function restoreDemo() {
    setDemoBusy(true);
    try {
      const result = await api<{ project: ProjectWorkspaceSummary; message: string }>(
        '/api/projects/demo/swissifier/restore',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmWrite: true }),
        }
      );
      props.onToast('ok', result.message);
      props.onOpenProject(result.project);
    } catch (nextError) {
      props.onToast('error', nextError instanceof Error ? nextError.message : String(nextError));
      await load();
    } finally {
      setDemoBusy(false);
    }
  }

  async function projectDeleted(message: string) {
    const deletedProjectId = deleteProject?.id;
    props.onToast('ok', message);
    if (deletedProjectId) props.onProjectDeleted(deletedProjectId);
    await load();
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  const reorderEnabled = Boolean(snapshot?.reorder_enabled && sort === 'manual' && !query.trim());
  const reorderDisabledReason = reorderEnabled
    ? undefined
    : 'Reorder is available in Manual sort with no search filter, so hidden projects never move unexpectedly.';

  return (
    <section aria-labelledby="projects-title" className="organization-page">
      <header className="organization-hero">
        <div>
          <span className="organization-eyebrow">Creative organization</span>
          <h1 id="projects-title" ref={headingRef} tabIndex={-1}>Projects</h1>
          <p>Group related canvases, assets, and creative work into focused spaces.</p>
        </div>
        <button className="primary-button organization-primary-action" onClick={() => setCreateOpen(true)} ref={createButtonRef} type="button">
          <Plus size={17} />New project
        </button>
      </header>

      <div className="organization-toolbar">
        <label className="organization-search">
          <span className="sr-only">Search projects</span>
          <Search aria-hidden="true" size={17} />
          <input
            aria-label="Search projects"
            onChange={event => setQuery(event.target.value)}
            placeholder="Search projects"
            type="search"
            value={query}
          />
        </label>
        <label className="organization-sort">
          <span>Sort</span>
          <select aria-label="Sort projects" onChange={event => setSort(event.target.value as CollectionSort)} value={sort}>
            <option value="manual">Manual order</option>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </select>
        </label>
        <div aria-label="Project presentation" className="organization-view-toggle" role="group">
          <button aria-label="Show projects as cards" aria-pressed={presentation === 'cards'} onClick={() => changePresentation('cards')} type="button"><Grid2X2 size={17} /></button>
          <button aria-label="Show projects as a list" aria-pressed={presentation === 'list'} onClick={() => changePresentation('list')} type="button"><List size={18} /></button>
        </div>
      </div>

      <div className="organization-collection-status" aria-live="polite">
        <span>{snapshot ? `${snapshot.pagination.total} project${snapshot.pagination.total === 1 ? '' : 's'}` : 'Projects'}</span>
        {loading && <span role="status">Updating…</span>}
      </div>

      {snapshot?.demo_restore_available && (
        <aside className="organization-preservation-note" aria-label="Restore Swissifier Demo">
          <div>
            <Sparkles aria-hidden="true" size={20} />
            <p><strong>Swissifier Demo is hidden.</strong><span>Restore it intentionally to recreate its project and populated lineage workspace.</span></p>
          </div>
          <button className="secondary-button" disabled={demoBusy} onClick={() => void restoreDemo()} type="button">
            {demoBusy ? 'Restoring…' : 'Restore demo'}
          </button>
        </aside>
      )}

      {error ? (
        <div className="organization-state organization-state-error" role="alert">
          <strong>Projects could not be loaded.</strong>
          <p>{error}</p>
          <button className="secondary-button" onClick={() => void load()} type="button">Try again</button>
        </div>
      ) : loading && !snapshot ? (
        <div className="organization-skeletons" aria-label="Loading projects" role="status">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
      ) : (
        <OrderedCollection
          ariaLabel="Projects"
          empty={
            <div className="organization-empty-copy">
              <FolderKanban aria-hidden="true" size={32} />
              <strong>{query ? 'No projects match that search' : 'Your first project starts here'}</strong>
              <p>{query ? 'Try a different name or clear the search.' : 'Create a project to organize canvases and related assets.'}</p>
              {!query && <button className="primary-button" onClick={() => setCreateOpen(true)} type="button"><Plus size={16} />Create project</button>}
            </div>
          }
          itemId={item => item.id}
          itemLabel={item => item.display_name}
          items={snapshot?.projects || []}
          onMove={moveProject}
          onOpen={props.onOpenProject}
          page={snapshot?.pagination.page || page}
          pageSize={snapshot?.pagination.pageSize || pageSize}
          presentation={presentation}
          renderItem={item => (
            <ProjectItem
              onDelete={event => {
                deleteButtonRef.current = event.currentTarget;
                setDeleteProject(item);
              }}
              onOpen={() => props.onOpenProject(item)}
              project={item}
            />
          )}
          reorderDisabledReason={reorderDisabledReason}
          reorderEnabled={reorderEnabled}
          total={snapshot?.pagination.total || 0}
        />
      )}

      {snapshot && snapshot.pagination.totalPages > 1 && (
        <footer className="organization-pagination" aria-label="Projects pagination">
          <button className="secondary-button" disabled={snapshot.pagination.page <= 1} onClick={() => setPage(value => value - 1)} type="button">Previous</button>
          <span>Page {snapshot.pagination.page} of {snapshot.pagination.totalPages}</span>
          <button className="secondary-button" disabled={snapshot.pagination.page >= snapshot.pagination.totalPages} onClick={() => setPage(value => value + 1)} type="button">Next</button>
          <label>
            Per page
            <select aria-label="Projects per page" onChange={event => setPageSize(Number(event.target.value))} value={pageSize}>
              {[6, 12, 24].map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </footer>
      )}

      {createOpen && (
        <CreateProjectDialog
          onClose={() => setCreateOpen(false)}
          onCreated={created => {
            props.onToast('ok', `Created ${created.display_name}`);
            const createdPage = Math.max(1, Math.ceil((created.sort_position + 1) / pageSize));
            const reloadCurrentPage = sort === 'manual' && !query.trim() && page === createdPage;
            preservePageOnFilterResetRef.current = sort !== 'manual' || Boolean(query.trim());
            setSort('manual');
            setQuery('');
            setPage(createdPage);
            if (reloadCurrentPage) void load();
          }}
          returnFocusRef={createButtonRef}
        />
      )}
      {deleteProject && (
        <DeleteProjectDialog
          onClose={() => setDeleteProject(null)}
          onDeleted={message => void projectDeleted(message)}
          project={deleteProject}
          returnFocusRef={deleteButtonRef}
        />
      )}
    </section>
  );
}

function ProjectItem(props: {
  onDelete: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  project: ProjectWorkspaceSummary;
}) {
  const demo = props.project.id === 'swissifier-demo';
  return (
    <div className="organization-item">
      <div className={`organization-item-symbol ${demo ? 'demo' : ''}`}>
        {demo ? <Sparkles aria-hidden="true" size={22} /> : <FolderKanban aria-hidden="true" size={22} />}
      </div>
      <div className="organization-item-copy">
        <div>
          {demo && <span className="organization-demo-badge">Demo</span>}
          <h2>{props.project.display_name}</h2>
          <p>{props.project.product || props.project.id}</p>
        </div>
        <dl className="organization-item-stats">
          <div><dt><Network size={14} />Workspaces</dt><dd>{props.project.workspace_count}</dd></div>
          <div><dt><Image size={14} />Assets</dt><dd>{props.project.asset_count}</dd></div>
        </dl>
        {props.project.catalog_state !== 'ready' && (
          <p className="organization-catalog-state" role="status">Catalog cleanup: {props.project.catalog_state.replaceAll('_', ' ')}</p>
        )}
      </div>
      <footer className="organization-item-actions">
        <button className="secondary-button organization-delete-action" onClick={props.onDelete} type="button"><Trash2 size={15} />Delete</button>
        <button className="primary-button" onClick={props.onOpen} type="button">Open project</button>
      </footer>
    </div>
  );
}
