import {
  GripVertical,
  MoveDown,
  MoveUp,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './OrderedCollection.css';

export type CollectionPresentation = 'cards' | 'list';

export interface OrderedCollectionProps<T> {
  ariaLabel: string;
  empty: ReactNode;
  itemId: (item: T) => string;
  itemLabel: (item: T) => string;
  items: T[];
  onMove: (itemId: string, targetIndex: number) => Promise<void> | void;
  onOpen?: (item: T) => void;
  page: number;
  pageSize: number;
  presentation: CollectionPresentation;
  renderItem: (item: T) => ReactNode;
  reorderDisabledReason?: string;
  reorderEnabled: boolean;
  total: number;
}

interface GrabbedState {
  id: string;
  originIds: string[];
  targetIndex: number;
}

export function OrderedCollection<T>(props: OrderedCollectionProps<T>) {
  const instructionsId = useId();
  const sourceIds = useMemo(() => props.items.map(props.itemId), [props.items, props.itemId]);
  const [draftIds, setDraftIds] = useState(sourceIds);
  const [grabbed, setGrabbed] = useState<GrabbedState | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const pointerActive = useRef(false);
  const collectionRef = useRef<HTMLDivElement | null>(null);
  const pendingOriginIds = useRef<string[] | null>(null);
  const previousPositions = useRef<Map<string, DOMRect>>(new Map());
  const pageOffset = Math.max(0, (props.page - 1) * props.pageSize);

  useEffect(() => {
    if (grabbed) return;
    if (pendingOriginIds.current && sameIds(sourceIds, pendingOriginIds.current)) return;
    pendingOriginIds.current = null;
    setDraftIds(sourceIds);
  }, [grabbed, sourceIds]);

  useLayoutEffect(() => {
    const collection = collectionRef.current;
    if (!collection || !previousPositions.current.size) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const element of collection.querySelectorAll<HTMLElement>('[data-ordered-id]')) {
      const previous = previousPositions.current.get(element.dataset.orderedId || '');
      if (!previous || reduceMotion || typeof element.animate !== 'function') continue;
      const current = element.getBoundingClientRect();
      const x = previous.left - current.left;
      const y = previous.top - current.top;
      if (Math.abs(x) < 1 && Math.abs(y) < 1) continue;
      element.animate(
        [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 190, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      );
    }
    previousPositions.current.clear();
  }, [draftIds]);

  const itemById = useMemo(
    () => new Map(props.items.map(item => [props.itemId(item), item])),
    [props.items, props.itemId]
  );
  const displayedItems = draftIds.map(id => itemById.get(id)).filter((item): item is T => Boolean(item));

  function capturePositions() {
    previousPositions.current = new Map(
      Array.from(collectionRef.current?.querySelectorAll<HTMLElement>('[data-ordered-id]') || [])
        .map(element => [element.dataset.orderedId || '', element.getBoundingClientRect()])
    );
  }

  function begin(item: T) {
    const id = props.itemId(item);
    const index = draftIds.indexOf(id);
    if (!props.reorderEnabled || pendingId || index < 0) return;
    setGrabbed({ id, originIds: sourceIds, targetIndex: pageOffset + index });
    setAnnouncement(`Picked up ${props.itemLabel(item)}, position ${pageOffset + index + 1} of ${props.total}.`);
  }

  function moveWithinPage(id: string, nextIndex: number) {
    capturePositions();
    setDraftIds(current => {
      const currentIndex = current.indexOf(id);
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.length || nextIndex === currentIndex) return current;
      const next = [...current];
      next.splice(currentIndex, 1);
      next.splice(nextIndex, 0, id);
      return next;
    });
    setGrabbed(current => current ? { ...current, targetIndex: pageOffset + nextIndex } : current);
    const item = itemById.get(id);
    if (item) setAnnouncement(`${props.itemLabel(item)} moved to position ${pageOffset + nextIndex + 1} of ${props.total}.`);
  }

  function moveToAbsolute(item: T, targetIndex: number) {
    const bounded = Math.max(0, Math.min(props.total - 1, targetIndex));
    const id = props.itemId(item);
    const localIndex = bounded - pageOffset;
    if (localIndex >= 0 && localIndex < draftIds.length) moveWithinPage(id, localIndex);
    else {
      setGrabbed(current => current ? { ...current, targetIndex: bounded } : current);
      setAnnouncement(`${props.itemLabel(item)} will move to position ${bounded + 1} of ${props.total} when dropped.`);
    }
  }

  async function commitMove(item: T, targetIndex: number) {
    const id = props.itemId(item);
    setPendingId(id);
    try {
      await props.onMove(id, targetIndex);
      setAnnouncement(`${props.itemLabel(item)} dropped at position ${targetIndex + 1} of ${props.total}.`);
    } catch (error) {
      pendingOriginIds.current = null;
      setDraftIds(sourceIds);
      setAnnouncement(`${props.itemLabel(item)} was not moved. ${error instanceof Error ? error.message : 'Refresh and try again.'}`);
      throw error;
    } finally {
      setPendingId(null);
    }
  }

  async function drop(item: T) {
    if (!grabbed || grabbed.id !== props.itemId(item)) return;
    const targetIndex = grabbed.targetIndex;
    pendingOriginIds.current = grabbed.originIds;
    setGrabbed(null);
    try {
      await commitMove(item, targetIndex);
    } catch {
      setDraftIds(grabbed.originIds);
    }
  }

  function cancel(item: T) {
    if (!grabbed || grabbed.id !== props.itemId(item)) return;
    setDraftIds(grabbed.originIds);
    setGrabbed(null);
    setAnnouncement(`Cancelled moving ${props.itemLabel(item)}.`);
  }

  function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>, item: T) {
    if (!props.reorderEnabled || pendingId) return;
    const id = props.itemId(item);
    const isGrabbed = grabbed?.id === id;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (isGrabbed) void drop(item);
      else begin(item);
      return;
    }
    if (!isGrabbed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel(item);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveToAbsolute(item, grabbed.targetIndex + (event.key === 'ArrowUp' ? -1 : 1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveToAbsolute(item, event.key === 'Home' ? 0 : props.total - 1);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>, item: T) {
    if (event.pointerType === 'touch') return;
    if (!props.reorderEnabled || event.pointerType === 'mouse' && event.button !== 0) return;
    pointerActive.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    begin(item);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>, item: T) {
    if (!pointerActive.current || grabbed?.id !== props.itemId(item)) return;
    const target = document.elementFromPoint?.(event.clientX, event.clientY)?.closest<HTMLElement>('[data-ordered-id]');
    if (!target) return;
    const nextIndex = draftIds.indexOf(target.dataset.orderedId || '');
    if (nextIndex >= 0) moveWithinPage(props.itemId(item), nextIndex);
  }

  function onPointerUp(item: T) {
    if (!pointerActive.current) return;
    pointerActive.current = false;
    void drop(item);
  }

  function onItemClick(event: MouseEvent<HTMLElement>, item: T) {
    if (!props.onOpen || isInteractiveTarget(event.target)) return;
    props.onOpen(item);
  }

  if (!props.items.length) {
    return <div className="ordered-collection-empty">{props.empty}</div>;
  }

  return (
    <>
      {props.reorderDisabledReason && (
        <p className="ordered-collection-reorder-note" role="note">{props.reorderDisabledReason}</p>
      )}
      <p className="sr-only" id={instructionsId}>
        Press Space or Enter to pick up. Use Arrow keys to move, Home or End to move across pages, Space or Enter to drop, and Escape to cancel.
      </p>
      <div
        aria-label={props.ariaLabel}
        className={`ordered-collection ordered-collection-${props.presentation}`}
        data-presentation={props.presentation}
        ref={collectionRef}
        role="list"
      >
        {displayedItems.map((item, index) => {
          const id = props.itemId(item);
          const isGrabbed = grabbed?.id === id;
          const isPending = pendingId === id;
          const position = pageOffset + index + 1;
          return (
            <article
              aria-posinset={position}
              aria-setsize={props.total}
              className={`ordered-collection-item ${props.onOpen ? 'is-openable' : ''} ${isGrabbed ? 'is-grabbed' : ''}`}
              data-ordered-id={id}
              key={id}
              onClick={event => onItemClick(event, item)}
              role="listitem"
            >
              <div className="ordered-collection-handle-cell">
                <button
                  aria-describedby={!props.reorderEnabled && props.reorderDisabledReason ? `${id}-reorder-disabled` : instructionsId}
                  aria-keyshortcuts="Space Enter ArrowUp ArrowDown Home End Escape"
                  aria-label={`Reorder ${props.itemLabel(item)}`}
                  aria-pressed={isGrabbed}
                  aria-busy={isPending}
                  className="ordered-collection-handle"
                  disabled={!props.reorderEnabled || Boolean(pendingId)}
                  onKeyDown={event => onHandleKeyDown(event, item)}
                  onPointerCancel={() => cancel(item)}
                  onPointerDown={event => onPointerDown(event, item)}
                  onPointerMove={event => onPointerMove(event, item)}
                  onPointerUp={() => onPointerUp(item)}
                  title={props.reorderEnabled ? 'Drag, or press Space to pick up' : props.reorderDisabledReason}
                  type="button"
                >
                  <GripVertical aria-hidden="true" size={18} />
                </button>
                {!props.reorderEnabled && props.reorderDisabledReason && (
                  <span className="sr-only" id={`${id}-reorder-disabled`}>{props.reorderDisabledReason}</span>
                )}
                <div className="ordered-collection-mobile-moves">
                  <button
                    aria-label={`Move ${props.itemLabel(item)} earlier`}
                    disabled={!props.reorderEnabled || Boolean(pendingId) || position <= 1}
                    onClick={() => void commitMove(item, position - 2).catch(() => undefined)}
                    type="button"
                  >
                    <MoveUp aria-hidden="true" size={15} />
                  </button>
                  <button
                    aria-label={`Move ${props.itemLabel(item)} later`}
                    disabled={!props.reorderEnabled || Boolean(pendingId) || position >= props.total}
                    onClick={() => void commitMove(item, position).catch(() => undefined)}
                    type="button"
                  >
                    <MoveDown aria-hidden="true" size={15} />
                  </button>
                </div>
              </div>
              <div className="ordered-collection-content">{props.renderItem(item)}</div>
            </article>
          );
        })}
      </div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
    </>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('button, a, input, select, textarea, [role="button"], [role="link"]'));
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
