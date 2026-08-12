import {
  ArrowLeft,
  ArchiveRestore,
  Bot,
  BookOpen,
  FileStack,
  FolderKanban,
  Images,
  Info,
  ListChecks,
  Menu,
  Network,
  PanelLeftClose,
  Settings,
  Upload,
  X,
} from 'lucide-react';
import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { LineageRuntimeInfo } from '../../shared/runtimeInfoTypes';
import type { ProjectWorkspaceSummary } from '../../shared/projectWorkspaceTypes';
import { appName } from '../../shared/appConstants';
import { placementFilters, sourceFilters, statusFilters, type PlacementFilter, type SourceFilter, type StudioView, type StatusFilter } from '../assetUi';
import { lineageReleaseInfo } from '../releaseInfo';
import { navigationViews } from './Topbar.navigation';
import { RuntimeIdentityBadge } from './Topbar';
import { AboutLineageDialog } from './AboutLineageDialog';
import './Sidebar.css';

const navigationIcons = {
  lineage: Network,
  assets: Images,
  content: FileStack,
  review: ListChecks,
  backup: ArchiveRestore,
  agents: Bot,
  ledger: BookOpen,
  settings: Settings,
} satisfies Record<StudioView, typeof FolderKanban>;

export function Sidebar(props: {
  channel: string;
  channels: string[];
  children: ReactNode;
  contextOpen: boolean;
  mobileContextOpen: boolean;
  onContextOpenChange: (open: boolean) => void;
  onMobileContextOpenChange: (open: boolean) => void;
  placementStatus: PlacementFilter;
  project: string;
  projects: ProjectWorkspaceSummary[];
  surface: 'projects' | 'project' | 'studio';
  canvasActive: boolean;
  canvasAvailable: boolean;
  onCanvas: () => void;
  onProjects: () => void;
  onProjectOverview: () => void;
  onStudio: (view: StudioView) => void;
  runtime: LineageRuntimeInfo | null;
  runtimeIdentityUnavailable: boolean;
  setChannel: (value: string) => void;
  setPlacementStatus: (value: PlacementFilter) => void;
  setProject?: (project: string) => void;
  setSource: (value: SourceFilter) => void;
  setStatus: (value: StatusFilter) => void;
  setUploadOpen: (value: boolean) => void;
  setView: (view: StudioView) => void;
  showBackupQueue: () => void;
  source: SourceFilter;
  status: StatusFilter;
  view: StudioView;
}) {
  const {
    channel,
    channels,
    mobileContextOpen,
    placementStatus,
    project,
    projects,
    setChannel,
    setPlacementStatus,
    setSource,
    setStatus,
    source,
    status,
  } = props;
  const showAssetFilters = props.surface === 'studio' && (props.view === 'assets' || props.view === 'review' || props.view === 'backup');
  const hasProject = projects.some(item => item.id === project);
  const projectDisplayName = projects.find(item => item.id === project)?.display_name || project;
  const mobileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileCloseRef = useRef<HTMLButtonElement | null>(null);
  const mobileWasOpen = useRef(mobileContextOpen);
  const aboutReturnFocusRef = useRef<HTMLElement | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    if (mobileContextOpen) mobileCloseRef.current?.focus();
    else if (mobileWasOpen.current) mobileTriggerRef.current?.focus();
    mobileWasOpen.current = mobileContextOpen;
  }, [mobileContextOpen]);

  function openView(view: StudioView) {
    const isActiveStudioView = props.surface === 'studio'
      && props.view === view
      && (view !== 'lineage' || props.canvasActive);
    if (isActiveStudioView) {
      if (!mobileContextOpen) props.onContextOpenChange(!props.contextOpen);
      props.onMobileContextOpenChange(false);
      return;
    }
    if (view === 'lineage') {
      props.onCanvas();
      props.onMobileContextOpenChange(false);
      return;
    }
    props.onStudio(view);
    if (view === 'backup') props.showBackupQueue();
    props.onMobileContextOpenChange(false);
  }

  function openAbout(event: MouseEvent<HTMLButtonElement>) {
    aboutReturnFocusRef.current = mobileContextOpen ? mobileTriggerRef.current : event.currentTarget;
    props.onMobileContextOpenChange(false);
    setAboutOpen(true);
  }

  return (
    <>
      <aside className="navigation-shell" aria-label="Application navigation">
        <nav className="navigation-rail" aria-label={`${appName} destinations`}>
          <div className="rail-brand">
            <button
              aria-label="Lineage home"
              className="brand-mark brand-button"
              onClick={() => {
                props.onProjects();
                props.onMobileContextOpenChange(false);
              }}
              title="All projects"
              type="button"
            >
              L
            </button>
          </div>
          <button
            aria-controls="contextual-navigation-panel"
            aria-expanded={mobileContextOpen}
            aria-label="Open navigation panel"
            className="rail-button mobile-navigation-toggle"
            onClick={() => props.onMobileContextOpenChange(!mobileContextOpen)}
            ref={mobileTriggerRef}
            type="button"
          >
            <Menu size={21} />
          </button>
          <div className="rail-destinations">
            {hasProject && props.surface !== 'projects' && (
              <button
                aria-current={props.surface === 'project' ? 'page' : undefined}
                aria-label="Workspaces"
                className={`rail-button ${props.surface === 'project' ? 'active' : ''}`}
                onClick={() => {
                  props.onProjectOverview();
                  props.onMobileContextOpenChange(false);
                }}
                title="Workspaces"
                type="button"
              >
                <FolderKanban size={20} />
              </button>
            )}
            {hasProject && props.surface !== 'projects' && navigationViews.filter(item => item.view !== 'settings').map(item => {
              const Icon = navigationIcons[item.view];
              const active = props.surface === 'studio'
                && props.view === item.view
                && (item.view !== 'lineage' || props.canvasActive);
              return (
                <button
                  aria-controls={active && props.surface === 'studio' ? 'contextual-navigation-panel' : undefined}
                  aria-current={active ? 'page' : undefined}
                  aria-expanded={active && props.surface === 'studio' ? props.contextOpen : undefined}
                  aria-label={item.label}
                  className={`rail-button ${active ? 'active' : ''}`}
                  disabled={item.view === 'lineage' && !props.canvasAvailable && !active}
                  key={item.view}
                  onClick={() => openView(item.view)}
                  title={item.view === 'lineage' && !props.canvasAvailable && !active ? 'Open a workspace to use Canvas' : item.label}
                  type="button"
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
          <div className="rail-bottom">
            {hasProject && props.surface !== 'projects' && <button
              aria-label="Create or upload"
              className="rail-button rail-upload"
              onClick={() => props.setUploadOpen(true)}
              title="Create or upload"
              type="button"
            >
              <Upload size={20} />
            </button>}
            {hasProject && props.surface !== 'projects' && <button
              aria-controls={props.surface === 'studio' && props.view === 'settings' ? 'contextual-navigation-panel' : undefined}
              aria-current={props.surface === 'studio' && props.view === 'settings' ? 'page' : undefined}
              aria-expanded={props.surface === 'studio' && props.view === 'settings' ? props.contextOpen : undefined}
              aria-label="Settings"
              className={`rail-button ${props.surface === 'studio' && props.view === 'settings' ? 'active' : ''}`}
              onClick={() => openView('settings')}
              title="Settings"
              type="button"
            >
              <Settings size={20} />
            </button>}
            <button
              aria-label="About Lineage"
              className="rail-button"
              onClick={openAbout}
              title="About Lineage"
              type="button"
            >
              <Info size={19} />
            </button>
            <RuntimeIdentityBadge
              compact
              runtime={props.runtime}
              unavailable={props.runtimeIdentityUnavailable}
            />
          </div>
        </nav>

        <section
          aria-label="Contextual navigation panel"
          aria-modal={mobileContextOpen || undefined}
          className="context-panel"
          id="contextual-navigation-panel"
          role={mobileContextOpen ? 'dialog' : undefined}
        >
          <header className="context-panel-header">
            <button
              aria-label="Open About Lineage"
              className="context-brand"
              onClick={openAbout}
              type="button"
            >
              <strong>{appName}</strong>
              <span className="brand-version" title={`${lineageReleaseInfo.channel} channel`}>v{lineageReleaseInfo.version}</span>
            </button>
            <button
              aria-label="Close navigation panel"
              className="context-close mobile-context-close"
              onClick={() => props.onMobileContextOpenChange(false)}
              ref={mobileCloseRef}
              type="button"
            >
              <X size={18} />
            </button>
            <button
              aria-label="Collapse contextual panel"
              className="context-close desktop-context-close"
              onClick={() => props.onContextOpenChange(false)}
              type="button"
            >
              <PanelLeftClose size={18} />
            </button>
          </header>

          <div className="context-panel-scroll">
            <nav className="mobile-context-destinations" aria-label="Mobile destinations">
              <button
                aria-current={props.surface === 'projects' ? 'page' : undefined}
                onClick={() => {
                  props.onProjects();
                  props.onMobileContextOpenChange(false);
                }}
                type="button"
              >
                <FolderKanban size={18} />
                All projects
              </button>
              {hasProject && props.surface !== 'projects' && (
                <button
                  aria-current={props.surface === 'project' ? 'page' : undefined}
                  onClick={() => {
                    props.onProjectOverview();
                    props.onMobileContextOpenChange(false);
                  }}
                  type="button"
                >
                  <FolderKanban size={18} />
                  Workspaces
                </button>
              )}
              {hasProject && props.surface !== 'projects' && navigationViews.map(item => {
                const Icon = navigationIcons[item.view];
                const active = props.surface === 'studio'
                  && props.view === item.view
                  && (item.view !== 'lineage' || props.canvasActive);
                return (
                  <button
                    aria-current={active ? 'page' : undefined}
                    disabled={item.view === 'lineage' && !props.canvasAvailable && !active}
                    key={item.view}
                    onClick={() => openView(item.view)}
                    type="button"
                  >
                    <Icon size={18} />
                    {item.label}
                  </button>
                );
              })}
              {hasProject && props.surface !== 'projects' && <button
                onClick={() => {
                  props.setUploadOpen(true);
                  props.onMobileContextOpenChange(false);
                }}
                type="button"
              >
                <Upload size={18} />
                Create or upload
              </button>}
            </nav>

            <section className="mobile-runtime-identity" aria-label="Mobile runtime identity">
              <h2>Runtime</h2>
              <RuntimeIdentityBadge
                runtime={props.runtime}
                unavailable={props.runtimeIdentityUnavailable}
              />
            </section>

            {props.surface !== 'projects' && (
              <section className="side-section context-location-section">
                <h2>{props.surface === 'studio' ? 'Project workspaces' : 'Projects'}</h2>
                {props.surface === 'studio' ? (
                  <button
                    aria-label={`Back to ${projectDisplayName} workspaces`}
                    className="context-location-card"
                    onClick={props.onProjectOverview}
                    type="button"
                  >
                    <span aria-hidden="true" className="context-location-card-icon"><ArrowLeft size={17} /></span>
                    <span className="context-location-card-copy">
                      <span>Back to workspaces</span>
                      <strong className="context-project-name">{projectDisplayName}</strong>
                      <small>Browse canvases and creative branches</small>
                    </span>
                    <FolderKanban aria-hidden="true" className="context-location-card-destination" size={17} />
                  </button>
                ) : (
                  <button
                    aria-label={`Back to all projects from ${projectDisplayName}`}
                    className="context-location-card"
                    onClick={props.onProjects}
                    type="button"
                  >
                    <span aria-hidden="true" className="context-location-card-icon"><ArrowLeft size={17} /></span>
                    <span className="context-location-card-copy">
                      <span>Back to all projects</span>
                      <strong className="context-project-name">{projectDisplayName}</strong>
                      <small>Choose another project</small>
                    </span>
                    <FolderKanban aria-hidden="true" className="context-location-card-destination" size={17} />
                  </button>
                )}
              </section>
            )}

            {props.surface === 'studio' && props.children}
            {props.surface === 'studio' && props.view === 'lineage' && (
              <section
                aria-label="Canvas workspace tools"
                className="canvas-context-tools-host"
                id="canvas-context-tools"
              />
            )}

            {showAssetFilters && (
              <section className="side-section asset-filter-section">
                <h2>Asset filters</h2>
                <div id="context-asset-filters">
                  <FilterSelect id="asset-source-filter" label="Source" value={source} values={sourceFilters} onChange={value => setSource(value as SourceFilter)} />
                  <FilterSelect id="asset-status-filter" label="Status" value={status} values={statusFilters} onChange={value => setStatus(value as StatusFilter)} />
                  <FilterSelect id="asset-channel-filter" label="Channel" value={channel} values={channels} onChange={setChannel} />
                  <FilterSelect id="asset-placement-filter" label="Placement" value={placementStatus} values={placementFilters} onChange={value => setPlacementStatus(value as PlacementFilter)} />
                </div>
              </section>
            )}
          </div>
        </section>

      </aside>
      {mobileContextOpen && (
        <button
          aria-label="Close navigation panel"
          className="navigation-backdrop"
          onClick={() => props.onMobileContextOpenChange(false)}
          type="button"
        />
      )}
      {aboutOpen && (
        <AboutLineageDialog
          onClose={() => setAboutOpen(false)}
          returnFocusRef={aboutReturnFocusRef}
          runtime={props.runtime}
          runtimeIdentityUnavailable={props.runtimeIdentityUnavailable}
        />
      )}
    </>
  );
}

function FilterSelect({
  id,
  label,
  value,
  values,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id}>
      {label}
      <select aria-label={label} id={id} value={value} onChange={event => onChange(event.target.value)}>
        {values.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>
  );
}
