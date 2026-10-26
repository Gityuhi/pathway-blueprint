import { useCallback, useEffect, useMemo, useState, useRef, useSyncExternalStore } from 'react';
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel,
  ReactFlowProvider,
  useReactFlow,
} from 'reactflow';
import type {
  Connection,
  Edge,
  Node,
} from 'reactflow';
import 'reactflow/dist/style.css';

import CustomNode from './CustomNode';
import TodoModal from './TodoModal';
import { isNodeDone, isNodeInProgress, type NodeData } from '../types';
import type { Roadmap } from '../store';

interface RoadmapEditorProps {
  roadmap: Roadmap;
  onSave: (updatedRoadmap: Roadmap) => void;
}

const nodeTypes = {
  custom: CustomNode,
};

const NODE_WIDTH = 280;
const NODE_X_GAP = 120;
const X_STEP = NODE_WIDTH + NODE_X_GAP;
const NODE_Y_GAP = 48;
/** ルート直下の子のみ、この個数ごとに左右へ折り返す */
const ROOT_CHILD_WRAP = 7;
const CLICK_DELAY_MS = 250;
const COPIED_LABEL_MS = 1600;

type ClipboardNode = {
  data: NodeData;
  children: ClipboardNode[];
};

/** ロードマップを切り替えても残す。複製ではなくペースト用 */
let subtreeClipboard: ClipboardNode | null = null;
const clipboardListeners = new Set<() => void>();

function subscribeSubtreeClipboard(listener: () => void) {
  clipboardListeners.add(listener);
  return () => {
    clipboardListeners.delete(listener);
  };
}

function hasSubtreeClipboard() {
  return subtreeClipboard !== null;
}

function setSubtreeClipboard(next: ClipboardNode | null) {
  subtreeClipboard = next;
  clipboardListeners.forEach((listener) => listener());
}

function buildChildrenMap(nodes: Node[], edges: Edge[]) {
  const childrenMap = new Map<string, string[]>();
  nodes.forEach((n) => childrenMap.set(n.id, []));
  const seenTargets = new Set<string>();
  edges.forEach((e) => {
    if (!e.source || !e.target || e.source === e.target) return;
    if (seenTargets.has(e.target)) return;
    const siblings = childrenMap.get(e.source);
    if (!siblings || !childrenMap.has(e.target)) return;
    seenTargets.add(e.target);
    siblings.push(e.target);
  });
  return childrenMap;
}

function getHiddenNodeIds(nodes: Node<NodeData>[], edges: Edge[]) {
  const childrenMap = buildChildrenMap(nodes, edges);
  const hidden = new Set<string>();
  const rootId = resolveRootId(nodes, edges);

  const hideDescendants = (nodeId: string) => {
    for (const childId of childrenMap.get(nodeId) || []) {
      if (hidden.has(childId)) continue;
      hidden.add(childId);
      hideDescendants(childId);
    }
  };

  nodes.forEach((n) => {
    const children = childrenMap.get(n.id) || [];
    children.forEach((childId, index) => {
      let side: CollapseSide;
      if (n.id === rootId) {
        side = rootChildSide(index);
      } else {
        const child = nodes.find((c) => c.id === childId);
        side =
          child && child.position.x < n.position.x ? 'left' : 'right';
      }
      if (isSideCollapsed(n.data, side)) {
        hidden.add(childId);
        hideDescendants(childId);
      }
    });
  });

  return hidden;
}

/** 自己ループと二重の親を捨て、子ごとの最初のエッジだけ残す */
function normalizeEdges(edges: Edge[]): Edge[] {
  const seenTargets = new Set<string>();
  const result: Edge[] = [];
  for (const edge of edges) {
    if (!edge.source || !edge.target || edge.source === edge.target) continue;
    if (seenTargets.has(edge.target)) continue;
    seenTargets.add(edge.target);
    result.push(edge);
  }
  return result;
}

function resolveRootId(nodes: { id: string }[], edges: Edge[]): string {
  if (nodes.some((n) => n.id === 'root')) return 'root';
  const targets = new Set(edges.map((e) => e.target));
  return nodes.find((n) => !targets.has(n.id))?.id ?? nodes[0]?.id ?? 'root';
}

function isTreeRoot(nodeId: string, nodes: { id: string }[], edges: Edge[]): boolean {
  return nodeId === resolveRootId(nodes, edges);
}

function getDirectChildren(nodeId: string, edges: Edge[]) {
  const seen = new Set<string>();
  const children: string[] = [];
  for (const edge of edges) {
    if (edge.source !== nodeId || edge.target === nodeId) continue;
    if (seen.has(edge.target)) continue;
    const firstParent = edges.find(
      (candidate) => candidate.target === edge.target && candidate.source !== candidate.target
    )?.source;
    if (firstParent !== nodeId) continue;
    seen.add(edge.target);
    children.push(edge.target);
  }
  return children;
}

function findDescendantIds(nodeId: string, edges: Edge[]): Set<string> {
  const ids = new Set<string>();
  const walk = (id: string) => {
    for (const childId of getDirectChildren(id, edges)) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      walk(childId);
    }
  };
  walk(nodeId);
  return ids;
}

function centerYOf(node: Node | undefined): number {
  if (!node) return 0;
  const height =
    typeof node.height === 'number' && node.height > 0
      ? node.height
      : estimateNodeHeight(node as Node<NodeData>);
  return node.position.y + height / 2;
}

/** ドラッグしたノードを、同じ列の中だけで Y 順に差し込む */
function reorderIdsByCenterY(
  ids: string[],
  draggedId: string,
  yOf: (id: string) => number
): string[] {
  if (!ids.includes(draggedId)) return ids;
  const draggedY = yOf(draggedId);
  const rest = ids.filter((id) => id !== draggedId);
  let insertAt = rest.length;
  for (let i = 0; i < rest.length; i += 1) {
    if (yOf(rest[i]) > draggedY) {
      insertAt = i;
      break;
    }
  }
  const next = [...rest];
  next.splice(insertAt, 0, draggedId);
  return next;
}

function reorderSiblings(
  parentId: string,
  draggedId: string,
  nodes: Node[],
  edges: Edge[]
): string[] {
  const childIds = getDirectChildren(parentId, edges);
  const yOf = (id: string) => centerYOf(nodes.find((node) => node.id === id));
  if (!isTreeRoot(parentId, nodes, edges)) {
    return reorderIdsByCenterY(childIds, draggedId, yOf);
  }

  const chunks: string[][] = [];
  for (let i = 0; i < childIds.length; i += ROOT_CHILD_WRAP) {
    chunks.push(childIds.slice(i, i + ROOT_CHILD_WRAP));
  }
  const chunkIndex = chunks.findIndex((chunk) => chunk.includes(draggedId));
  if (chunkIndex < 0) return childIds;
  chunks[chunkIndex] = reorderIdsByCenterY(chunks[chunkIndex], draggedId, yOf);
  return chunks.flat();
}

/** 縦に並ぶ同じ列の兄弟。並べ替え中にここへ落とすと親が変わってしまう */
function sameColumnSiblingIds(draggedId: string, nodes: Node[], edges: Edge[]): Set<string> {
  const parentId = edges.find(
    (edge) => edge.target === draggedId && edge.source !== edge.target
  )?.source;
  if (!parentId) return new Set();
  const childIds = getDirectChildren(parentId, edges);
  if (isTreeRoot(parentId, nodes, edges)) {
    const index = childIds.indexOf(draggedId);
    if (index < 0) return new Set();
    const start = Math.floor(index / ROOT_CHILD_WRAP) * ROOT_CHILD_WRAP;
    return new Set(
      childIds.slice(start, start + ROOT_CHILD_WRAP).filter((id) => id !== draggedId)
    );
  }
  return new Set(childIds.filter((id) => id !== draggedId));
}

function edgesWithChildOrder(edges: Edge[], parentId: string, childIds: string[]): Edge[] {
  const childSet = new Set(childIds);
  const kept = edges.filter((edge) => !childSet.has(edge.target));
  const ordered = childIds.map(
    (id) =>
      edges.find((edge) => edge.source === parentId && edge.target === id) ??
      makeParentEdge(parentId, id)
  );
  return normalizeEdges([...kept, ...ordered]);
}

/** 実測値があれば優先。なければタイトル行数などから推定 */
function estimateNodeHeight(node: Node<NodeData>): number {
  if (typeof node.height === 'number' && node.height > 0) {
    return node.height;
  }
  const title = node.data.title || '無題のノード';
  const done = isNodeDone(node.data);
  const inProgress = isNodeInProgress(node.data);
  const showDeadline = Boolean(node.data.deadline) && !done;
  const charCount = [...title].length;
  // status があるときは右列の分だけタイトル幅が狭くなる
  const charsPerLine = inProgress || done ? 10 : 13;
  const lines = Math.min(2, Math.max(1, Math.ceil(charCount / charsPerLine)));
  const titleH = lines * 22;
  const deadlineLineH = showDeadline ? 16 : 0;
  const leftH = titleH + deadlineLineH;
  const statusH = inProgress || done ? 22 : 0;
  const daysH = showDeadline ? 32 : 0;
  const rightH = statusH + (statusH > 0 && daysH > 0 ? 4 : 0) + daysH;
  const progressH = 36;
  const paddingY = 24;
  const gap = 8;
  return paddingY + Math.max(leftH, rightH) + gap + progressH;
}

function nodeCenter(node: Node) {
  const w = node.width ?? NODE_WIDTH;
  const h =
    typeof node.height === 'number' && node.height > 0
      ? node.height
      : estimateNodeHeight(node as Node<NodeData>);
  return {
    x: node.position.x + w / 2,
    y: node.position.y + h / 2,
  };
}

function nodeArea(node: Node): number {
  const width = node.width && node.width > 0 ? node.width : NODE_WIDTH;
  const height =
    node.height && node.height > 0
      ? node.height
      : estimateNodeHeight(node as Node<NodeData>);
  return width * height;
}

/**
 * ドラッグ中ノードの中心が乗っているノードだけを付け替え先にする。
 * 同じ列の兄弟は並べ替え対象なので除外する。近接だけでは選ばない。
 */
function pickDropTarget(draggedNode: Node, edges: Edge[], allNodes: Node[]): Node | null {
  const descendants = findDescendantIds(draggedNode.id, edges);
  const blocked = sameColumnSiblingIds(draggedNode.id, allNodes, edges);
  const center = nodeCenter(draggedNode);

  const candidates = allNodes.filter((node) => {
    if (node.id === draggedNode.id || node.hidden) return false;
    if (descendants.has(node.id) || blocked.has(node.id)) return false;
    const width = node.width && node.width > 0 ? node.width : NODE_WIDTH;
    const height =
      node.height && node.height > 0
        ? node.height
        : estimateNodeHeight(node as Node<NodeData>);
    return (
      center.x >= node.position.x &&
      center.x <= node.position.x + width &&
      center.y >= node.position.y &&
      center.y <= node.position.y + height
    );
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => nodeArea(a) - nodeArea(b));
  return candidates[0];
}

function makeParentEdge(parentId: string, childId: string): Edge {
  return {
    id: `e-${parentId}-${childId}`,
    source: parentId,
    target: childId,
    animated: true,
    style: { stroke: '#b1b1b7', strokeWidth: 2 },
  };
}

type CollapseSide = 'left' | 'right';

function isSideCollapsed(data: NodeData | undefined, side: CollapseSide): boolean {
  if (!data) return false;
  // 旧データ互換: collapsed は両側閉じ
  if (data.collapsed) return true;
  return side === 'left' ? !!data.collapsedLeft : !!data.collapsedRight;
}

/** ルート直下の子 index → 左右（7個折り返しと同じ規則） */
function rootChildSide(index: number): CollapseSide {
  const chunkIndex = Math.floor(index / ROOT_CHILD_WRAP);
  return chunkIndex % 2 === 0 ? 'right' : 'left';
}

function toggleSideCollapse(data: NodeData, side: CollapseSide): NodeData {
  const left = isSideCollapsed(data, 'left');
  const right = isSideCollapsed(data, 'right');
  const nextLeft = side === 'left' ? !left : left;
  const nextRight = side === 'right' ? !right : right;
  const next: NodeData = { ...data };
  delete next.collapsed;
  if (nextLeft) next.collapsedLeft = true;
  else delete next.collapsedLeft;
  if (nextRight) next.collapsedRight = true;
  else delete next.collapsedRight;
  return next;
}

function expandSide(data: NodeData, side: CollapseSide): NodeData {
  if (!isSideCollapsed(data, side)) return data;
  return toggleSideCollapse(data, side);
}

/**
 * ツリーを自動配置する。
 * React Flow の position は左上基準なので、ノード中心が揃うよう y を補正する。
 * ルート直下の子のみ ROOT_CHILD_WRAP 個ごとに左右へ折り返す。
 */
function getLayoutedElements(currentNodes: Node<NodeData>[], currentEdges: Edge[]) {
  if (currentNodes.length === 0) return currentNodes;

  const childrenMap = buildChildrenMap(currentNodes, currentEdges);
  const heightOf = (nodeId: string) => {
    const node = currentNodes.find((n) => n.id === nodeId);
    return node ? estimateNodeHeight(node) : 88;
  };

  const rootId = resolveRootId(currentNodes, currentEdges);
  const subtreeHeights = new Map<string, number>();
  const visiting = new Set<string>();

  const columnHeight = (childIds: string[]) => {
    let total = 0;
    childIds.forEach((childId, index) => {
      total += subtreeHeights.get(childId) || heightOf(childId);
      if (index < childIds.length - 1) total += NODE_Y_GAP;
    });
    return total;
  };

  const calculateHeight = (nodeId: string, dir: 1 | -1 = 1): number => {
    const cached = subtreeHeights.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return heightOf(nodeId);
    visiting.add(nodeId);
    const node = currentNodes.find((n) => n.id === nodeId);
    const allChildren = childrenMap.get(nodeId) || [];
    const selfH = heightOf(nodeId);
    const data = node?.data;

    if (nodeId === rootId) {
      // 可視側の子だけ高さ計算
      allChildren.forEach((childId, index) => {
        const side = rootChildSide(index);
        if (!isSideCollapsed(data, side)) {
          calculateHeight(childId, side === 'left' ? -1 : 1);
        }
      });

      if (allChildren.length === 0) {
        subtreeHeights.set(nodeId, selfH);
        return selfH;
      }

      let maxCol = 0;
      for (let i = 0; i < allChildren.length; i += ROOT_CHILD_WRAP) {
        const side = rootChildSide(i);
        if (isSideCollapsed(data, side)) continue;
        const chunk = allChildren.slice(i, i + ROOT_CHILD_WRAP);
        maxCol = Math.max(maxCol, columnHeight(chunk));
      }
      const total = Math.max(selfH, maxCol);
      subtreeHeights.set(nodeId, total);
      return total;
    }

    const side: CollapseSide = dir === -1 ? 'left' : 'right';
    if (isSideCollapsed(data, side) || allChildren.length === 0) {
      subtreeHeights.set(nodeId, selfH);
      return selfH;
    }

    allChildren.forEach((childId) => calculateHeight(childId, dir));
    const total = Math.max(selfH, columnHeight(allChildren));
    subtreeHeights.set(nodeId, total);
    return total;
  };

  calculateHeight(rootId, 1);

  const newPositions = new Map<string, { x: number; y: number }>();
  const placed = new Set<string>();

  /**
   * @param dir 子孫を伸ばす方向（1=右, -1=左）
   */
  const setPosition = (
    nodeId: string,
    x: number,
    centerY: number,
    dir: 1 | -1 = 1
  ) => {
    if (placed.has(nodeId)) return;
    placed.add(nodeId);
    const node = currentNodes.find((n) => n.id === nodeId);
    const allChildren = childrenMap.get(nodeId) || [];
    const selfH = heightOf(nodeId);
    const data = node?.data;

    newPositions.set(nodeId, { x, y: centerY - selfH / 2 });

    if (nodeId === rootId) {
      for (let i = 0; i < allChildren.length; i += ROOT_CHILD_WRAP) {
        const chunkIndex = i / ROOT_CHILD_WRAP;
        const side = rootChildSide(i);
        if (isSideCollapsed(data, side)) continue;

        const chunk = allChildren.slice(i, i + ROOT_CHILD_WRAP);
        const sideDir: 1 | -1 = chunkIndex % 2 === 0 ? 1 : -1;
        const depth = Math.floor(chunkIndex / 2) + 1;
        const childX = x + sideDir * depth * X_STEP;

        const colH = columnHeight(chunk);
        let cursor = centerY - colH / 2;
        chunk.forEach((childId) => {
          const childSubtreeH =
            subtreeHeights.get(childId) || heightOf(childId);
          setPosition(
            childId,
            childX,
            cursor + childSubtreeH / 2,
            sideDir
          );
          cursor += childSubtreeH + NODE_Y_GAP;
        });
      }
      return;
    }

    const side: CollapseSide = dir === -1 ? 'left' : 'right';
    if (isSideCollapsed(data, side) || allChildren.length === 0) return;

    const colH = columnHeight(allChildren);
    let cursor = centerY - colH / 2;
    allChildren.forEach((childId) => {
      const childSubtreeH = subtreeHeights.get(childId) || heightOf(childId);
      setPosition(
        childId,
        x + dir * X_STEP,
        cursor + childSubtreeH / 2,
        dir
      );
      cursor += childSubtreeH + NODE_Y_GAP;
    });
  };

  setPosition(rootId, 0, 0, 1);

  return currentNodes.map((node) => {
    if (newPositions.has(node.id)) {
      return { ...node, position: newPositions.get(node.id)! };
    }
    return node;
  });
}

function stripUiMeta(data: NodeData): NodeData {
  const rest: NodeData = {
    title: data.title,
    todos: data.todos,
    progress: data.progress,
  };
  if (data.memo !== undefined) rest.memo = data.memo;
  if (data.deadline !== undefined) rest.deadline = data.deadline;
  // 旧 collapsed は左右両方へ移行して保存
  const left = isSideCollapsed(data, 'left');
  const right = isSideCollapsed(data, 'right');
  if (left) rest.collapsedLeft = true;
  if (right) rest.collapsedRight = true;
  return rest;
}

/** コピー対象は構造・タイトル・メモだけ。進捗・期限・ステータス（進捗由来）は持たない */
function copyableNodeData(data: NodeData): NodeData {
  const next: NodeData = {
    title: data.title,
    todos: [],
    progress: 0,
  };
  if (data.memo?.trim()) next.memo = data.memo;
  return next;
}

function withoutCollapse(data: NodeData): NodeData {
  const next = { ...data };
  delete next.collapsed;
  delete next.collapsedLeft;
  delete next.collapsedRight;
  return next;
}

function captureSubtree(
  nodeId: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  seen = new Set<string>()
): ClipboardNode | null {
  if (seen.has(nodeId)) return null;
  seen.add(nodeId);
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const children = getDirectChildren(nodeId, edges).flatMap((childId) => {
    const child = captureSubtree(childId, nodes, edges, seen);
    return child ? [child] : [];
  });
  return { data: copyableNodeData(node.data), children };
}

function materializeChildren(
  parentId: string,
  children: ClipboardNode[],
  createdNodes: Node<NodeData>[],
  createdEdges: Edge[]
) {
  children.forEach((child) => {
    const id = crypto.randomUUID();
    const data = copyableNodeData(child.data);
    const created: Node<NodeData> = {
      id,
      type: 'custom',
      position: { x: 0, y: 0 },
      data,
      width: NODE_WIDTH,
      height: estimateNodeHeight({
        id,
        position: { x: 0, y: 0 },
        data,
      }),
    };
    createdNodes.push(created);
    createdEdges.push(makeParentEdge(parentId, id));
    materializeChildren(id, child.children, createdNodes, createdEdges);
  });
}

function sideForNewChild(
  parentId: string,
  childIndex: number,
  nodes: Node[],
  edges: Edge[]
): CollapseSide {
  if (isTreeRoot(parentId, nodes, edges)) return rootChildSide(childIndex);
  const parentNode = nodes.find((node) => node.id === parentId);
  const parentOfParentId = edges.find((edge) => edge.target === parentId)?.source;
  const parentOfParent = parentOfParentId
    ? nodes.find((node) => node.id === parentOfParentId)
    : undefined;
  const growsLeft =
    !!parentNode &&
    !!parentOfParent &&
    parentNode.position.x < parentOfParent.position.x;
  return growsLeft ? 'left' : 'right';
}

function Flow({ roadmap, onSave }: RoadmapEditorProps) {
  const isLoaded = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [copiedNodeId, setCopiedNodeId] = useState<string | null>(null);
  const [pastedNodeId, setPastedNodeId] = useState<string | null>(null);
  const canPaste = useSyncExternalStore(
    subscribeSubtreeClipboard,
    hasSubtreeClipboard,
    () => false
  );

  const clickTimeoutRef = useRef<number | null>(null);
  const measuredLayoutDoneRef = useRef(false);
  const { fitView, getNodes } = useReactFlow();
  const copiedTimerRef = useRef<number | null>(null);
  const pastedTimerRef = useRef<number | null>(null);

  // Load data
  useEffect(() => {
    measuredLayoutDoneRef.current = false;
    const layouted = getLayoutedElements(
      roadmap.nodes as Node<NodeData>[],
      roadmap.edges
    );
    setNodes(layouted);
    setEdges(roadmap.edges);
    setFocusedNodeId(null);
    setDraggingNodeId(null);
    setDropTargetId(null);
    setTimeout(() => fitView({ duration: 800 }), 100);
    isLoaded.current = true;
  }, [roadmap.id]);

  // 実測サイズが揃ったら再レイアウト（行数差によるズレを解消）
  useEffect(() => {
    if (!isLoaded.current || measuredLayoutDoneRef.current) return;
    if (nodes.length === 0) return;
    const allMeasured = nodes.every(
      (n) => typeof n.height === 'number' && n.height > 0
    );
    if (!allMeasured) return;

    measuredLayoutDoneRef.current = true;
    setNodes((nds) => getLayoutedElements(nds as Node<NodeData>[], edges));
    setTimeout(() => fitView({ duration: 400 }), 50);
  }, [nodes, edges, setNodes, fitView]);

  // Auto-save (strip UI-only fields)
  useEffect(() => {
    if (!isLoaded.current) return;

    const rootNode = nodes.find((n) => n.id === 'root');
    const newTitle = rootNode ? rootNode.data.title : roadmap.title;

    const handler = setTimeout(() => {
      onSave({
        ...roadmap,
        title: newTitle,
        nodes: nodes.map((n) => ({
          ...n,
          data: stripUiMeta(n.data),
        })),
        edges,
        updatedAt: Date.now(),
      });
    }, 1000);

    return () => clearTimeout(handler);
  }, [nodes, edges]);

  const getNodeData = (id: string | null) => {
    if (!id) return null;
    return nodes.find((n) => n.id === id)?.data;
  };

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || params.source === params.target) return;
      if (edges.some((edge) => edge.target === params.target)) return;
      if (findDescendantIds(params.target, edges).has(params.source)) return;
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: `e-${params.source}-${params.target}`,
            animated: true,
            style: { stroke: '#b1b1b7', strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [edges, setEdges]
  );

  const handleToggleCollapse = useCallback(
    (nodeId: string, side: 'left' | 'right') => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: toggleSideCollapse(n.data, side) }
            : n
        );
        return getLayoutedElements(updated, edges);
      });
    },
    [edges, setNodes]
  );

  const pinchInToNode = useCallback(
    (nodeId: string) => {
      const hiddenIds = getHiddenNodeIds(nodes as Node<NodeData>[], edges);
      const childIds = getDirectChildren(nodeId, edges).filter(
        (id) => !hiddenIds.has(id)
      );
      const targetIds = [nodeId, ...childIds];

      fitView({
        nodes: targetIds.map((id) => ({ id })),
        duration: 500,
        padding: 0.35,
        maxZoom: 1.5,
      });
    },
    [nodes, edges, fitView]
  );

  const clearClickTimeout = () => {
    if (clickTimeoutRef.current !== null) {
      window.clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
    }
  };

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      clearClickTimeout();

      if (focusedNodeId !== node.id) {
        setFocusedNodeId(node.id);
        return;
      }

      // Already focused → schedule pinch-in (cancelled by double-click)
      clickTimeoutRef.current = window.setTimeout(() => {
        pinchInToNode(node.id);
        clickTimeoutRef.current = null;
      }, CLICK_DELAY_MS);
    },
    [focusedNodeId, pinchInToNode]
  );

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      clearClickTimeout();
      setFocusedNodeId(node.id);
      setEditingNodeId(node.id);
      setModalOpen(true);
    },
    []
  );

  const handlePaneClick = useCallback(() => {
    clearClickTimeout();
    setFocusedNodeId(null);
  }, []);

  // ドラッグ開始: ハイライト
  const handleNodeDragStart = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      clearClickTimeout();
      setDraggingNodeId(draggedNode.id);
      setFocusedNodeId(draggedNode.id);
      setDropTargetId(null);
    },
    []
  );

  // ドラッグ中: 交差／近接ノードをドロップ候補としてハイライト
  const handleNodeDrag = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      if (draggedNode.id === 'root') {
        setDropTargetId(null);
        return;
      }
      const target = pickDropTarget(draggedNode, edges, getNodes());
      setDropTargetId(target?.id ?? null);
    },
    [edges, getNodes]
  );

  // ドラッグ終了: 他ノードへドロップなら親変更、否则は同親の兄弟並べ替え
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      const nodesWithDrag = nodes.map((n) =>
        n.id === draggedNode.id
          ? { ...n, position: { ...draggedNode.position } }
          : n
      );

      let resolvedDropId: string | null = null;
      if (draggedNode.id !== 'root') {
        resolvedDropId = pickDropTarget(draggedNode, edges, getNodes())?.id ?? null;
      }
      setDropTargetId(null);
      setDraggingNodeId(null);

      const currentParentId = edges.find((e) => e.target === draggedNode.id)?.source;

      // 別ノードの上で離したときだけ、サブツリーごと付け替える
      if (resolvedDropId && resolvedDropId !== currentParentId) {
        const withoutOldParent = edges.filter((e) => e.target !== draggedNode.id);
        const nextEdges = normalizeEdges([
          ...withoutOldParent,
          makeParentEdge(resolvedDropId, draggedNode.id),
        ]);

        const childIndex = getDirectChildren(resolvedDropId, withoutOldParent).length;
        const side = sideForNewChild(
          resolvedDropId,
          childIndex,
          nodesWithDrag,
          withoutOldParent
        );
        const nextNodes = nodesWithDrag.map((n) => {
          if (n.id !== resolvedDropId) return n;
          return {
            ...n,
            data: expandSide(n.data, side),
          };
        });

        const layoutedNodes = getLayoutedElements(nextNodes, nextEdges);
        setNodes(layoutedNodes);
        setEdges(nextEdges);
        setFocusedNodeId(draggedNode.id);
        return;
      }

      // 同じ列の中だけで並べ替える。左右の列は混ぜない
      let nextEdges = edges;
      if (currentParentId) {
        const orderedChildIds = reorderSiblings(
          currentParentId,
          draggedNode.id,
          nodesWithDrag,
          edges
        );
        nextEdges = edgesWithChildOrder(edges, currentParentId, orderedChildIds);
      }

      const layoutedNodes = getLayoutedElements(nodesWithDrag, nextEdges);
      setNodes(layoutedNodes);
      if (nextEdges !== edges) {
        setEdges(nextEdges);
      }
      setFocusedNodeId(draggedNode.id);
    },
    [nodes, edges, setNodes, setEdges, getNodes]
  );

  const handleUpdateNode = useCallback(
    (id: string, newData: NodeData) => {
      setNodes((nds) => {
        const updated = nds.map((node) => {
          if (node.id === id) {
            const cleaned = stripUiMeta(newData);
            const nextData: NodeData = {
              ...node.data,
              ...cleaned,
              collapsedLeft: node.data.collapsedLeft,
              collapsedRight: node.data.collapsedRight,
              // undefined のときも明示的に消し、旧メモが残らないようにする
              memo: cleaned.memo,
            };
            if (!nextData.memo) {
              delete nextData.memo;
            }
            delete nextData.collapsed;
            return { ...node, data: nextData };
          }
          return node;
        });
        return getLayoutedElements(updated, edges);
      });
    },
    [setNodes, edges]
  );

  const addChildNode = useCallback(() => {
    const selectedNode =
      nodes.find((n) => n.id === focusedNodeId) || nodes.find((n) => n.selected);
    if (!selectedNode) return;

    const parentId = selectedNode.id;
    const newNodeId = crypto.randomUUID();

    const newNode: Node<NodeData> = {
      id: newNodeId,
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { title: '新しいノード', todos: [], progress: 0 },
      selected: true,
    };

    const newEdge: Edge = {
      id: `e-${parentId}-${newNodeId}`,
      source: parentId,
      target: newNodeId,
      animated: true,
      style: { stroke: '#b1b1b7', strokeWidth: 2 },
    };

    // Expanding parent on the side where the new child will appear
    const existingChildCount = edges.filter((e) => e.source === parentId).length;
    let rootId = 'root';
    if (!nodes.find((n) => n.id === 'root')) {
      const nodeIds = new Set(nodes.map((n) => n.id));
      const targetIds = new Set(edges.map((e) => e.target));
      for (const id of nodeIds) {
        if (!targetIds.has(id)) {
          rootId = id;
          break;
        }
      }
    }
    const parentNode = nodes.find((n) => n.id === parentId);
    const parentOfParent = edges.find((e) => e.target === parentId)?.source;
    const parentGrowsLeft =
      parentOfParent &&
      parentNode &&
      parentNode.position.x <
        (nodes.find((n) => n.id === parentOfParent)?.position.x ?? 0);

    const expandOnSide: CollapseSide =
      parentId === rootId
        ? rootChildSide(existingChildCount)
        : parentGrowsLeft
          ? 'left'
          : 'right';

    const nextNodes = [
      ...nodes.map((n) => ({
        ...n,
        selected: false,
        data:
          n.id === parentId ? expandSide(n.data, expandOnSide) : n.data,
      })),
      newNode,
    ];
    const nextEdges = [...edges, newEdge];
    const layoutedNodes = getLayoutedElements(nextNodes, nextEdges);

    setNodes(layoutedNodes);
    setEdges(nextEdges);
    setFocusedNodeId(newNodeId);
  }, [nodes, edges, focusedNodeId, setNodes, setEdges]);

  const handleDelete = useCallback(() => {
    const selectedNodes = nodes.filter(
      (n) => n.selected || n.id === focusedNodeId
    );
    if (selectedNodes.length === 0) return;

    const nodesToDelete = new Set<string>();

    const findDescendants = (parentId: string, currentEdges: Edge[]) => {
      const children = currentEdges
        .filter((e) => e.source === parentId)
        .map((e) => e.target);
      children.forEach((childId) => {
        nodesToDelete.add(childId);
        findDescendants(childId, currentEdges);
      });
    };

    selectedNodes.forEach((node) => {
      nodesToDelete.add(node.id);
      findDescendants(node.id, edges);
    });

    const hasChildren = nodesToDelete.size > selectedNodes.length;

    if (hasChildren) {
      if (!confirm('子ノードも一緒に削除されますがよろしいですか？')) {
        return;
      }
    }

    const remainingNodes = nodes.filter((n) => !nodesToDelete.has(n.id));
    const remainingEdges = edges.filter(
      (e) => !nodesToDelete.has(e.source) && !nodesToDelete.has(e.target)
    );

    const layoutedNodes = getLayoutedElements(remainingNodes, remainingEdges);
    setNodes(layoutedNodes);
    setEdges(remainingEdges);
    setFocusedNodeId(null);
  }, [nodes, edges, focusedNodeId, setNodes, setEdges]);

  const selectNextNode = useCallback(() => {
    setNodes((nds) => {
      const selectedIndex = nds.findIndex(
        (n) => n.id === focusedNodeId || n.selected
      );
      if (selectedIndex === -1 && nds.length > 0) {
        setFocusedNodeId(nds[0].id);
        return nds.map((n, i) => (i === 0 ? { ...n, selected: true } : { ...n, selected: false }));
      }
      const nextIndex = (selectedIndex + 1) % nds.length;
      setFocusedNodeId(nds[nextIndex].id);
      return nds.map((n, i) => ({ ...n, selected: i === nextIndex }));
    });
  }, [setNodes, focusedNodeId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (modalOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return;

      if (e.key === 'Enter') {
        e.preventDefault();
        addChildNode();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectNextNode();
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        handleDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addChildNode, selectNextNode, handleDelete, modalOpen]);

  useEffect(() => {
    return () => {
      clearClickTimeout();
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      if (pastedTimerRef.current !== null) window.clearTimeout(pastedTimerRef.current);
    };
  }, []);

  const flashNodeLabel = (
    nodeId: string,
    setId: (value: string | null | ((current: string | null) => string | null)) => void,
    timerRef: { current: number | null }
  ) => {
    setId(nodeId);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setId((current) => (current === nodeId ? null : current));
      timerRef.current = null;
    }, COPIED_LABEL_MS);
  };

  const handleCopySubtree = useCallback(
    (nodeId: string) => {
      const snapshot = captureSubtree(nodeId, nodes, edges);
      if (!snapshot) return;
      setSubtreeClipboard(snapshot);
      flashNodeLabel(nodeId, setCopiedNodeId, copiedTimerRef);
    },
    [nodes, edges]
  );

  const handlePasteSubtree = useCallback(
    (nodeId: string) => {
      const snapshot = subtreeClipboard;
      const target = nodes.find((node) => node.id === nodeId);
      if (!snapshot || !target) return;

      const removeIds = findDescendantIds(nodeId, edges);
      const createdNodes: Node<NodeData>[] = [];
      const createdEdges: Edge[] = [];
      materializeChildren(nodeId, snapshot.children, createdNodes, createdEdges);

      const nextNodes = [
        ...nodes
          .filter((node) => !removeIds.has(node.id))
          .map((node) =>
            node.id === nodeId
              ? { ...node, data: withoutCollapse(copyableNodeData(snapshot.data)) }
              : node
          ),
        ...createdNodes,
      ];
      const nextEdges = normalizeEdges([
        ...edges.filter(
          (edge) => !removeIds.has(edge.source) && !removeIds.has(edge.target)
        ),
        ...createdEdges,
      ]);

      setNodes(getLayoutedElements(nextNodes, nextEdges));
      setEdges(nextEdges);
      setFocusedNodeId(nodeId);
      flashNodeLabel(nodeId, setPastedNodeId, pastedTimerRef);
    },
    [nodes, edges, setNodes, setEdges]
  );

  const childrenMap = useMemo(
    () => buildChildrenMap(nodes, edges),
    [nodes, edges]
  );

  const hiddenNodeIds = useMemo(
    () => getHiddenNodeIds(nodes as Node<NodeData>[], edges),
    [nodes, edges]
  );

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const childIds = childrenMap.get(n.id) || [];
        const isDragging = n.id === draggingNodeId;
        const parentEdge = edges.find((e) => e.target === n.id);
        const parent = parentEdge
          ? nodes.find((p) => p.id === parentEdge.source)
          : undefined;
        const growsLeft = parent
          ? n.position.x < parent.position.x
          : false;

        // ルートは折り返し規則、それ以外は成長方向で左右を判定
        let leftChildIds: string[] = [];
        let rightChildIds: string[] = [];
        if (!parent) {
          childIds.forEach((id, index) => {
            if (rootChildSide(index) === 'left') leftChildIds.push(id);
            else rightChildIds.push(id);
          });
        } else if (growsLeft) {
          leftChildIds = childIds;
        } else {
          rightChildIds = childIds;
        }

        return {
          ...n,
          hidden: hiddenNodeIds.has(n.id),
          selected: n.id === focusedNodeId || !!n.selected,
          style: {
            ...n.style,
            overflow: 'visible',
            zIndex: isDragging ? 1000 : n.id === focusedNodeId ? 20 : 1,
          },
          data: {
            ...n.data,
            hasChildren: childIds.length > 0,
            hasLeftChildren: leftChildIds.length > 0,
            hasRightChildren: rightChildIds.length > 0,
            childCount: childIds.length,
            leftChildCount: leftChildIds.length,
            rightChildCount: rightChildIds.length,
            onToggleCollapse: handleToggleCollapse,
            showCopyButton: n.id === focusedNodeId && !isDragging,
            justCopied: n.id === copiedNodeId,
            justPasted: n.id === pastedNodeId,
            canPaste,
            onCopySubtree: handleCopySubtree,
            onPasteSubtree: handlePasteSubtree,
            isDropTarget: n.id === dropTargetId,
            isDragging,
            growsLeft,
          },
        };
      }),
    [
      nodes,
      edges,
      childrenMap,
      hiddenNodeIds,
      focusedNodeId,
      handleToggleCollapse,
      handleCopySubtree,
      handlePasteSubtree,
      copiedNodeId,
      pastedNodeId,
      canPaste,
      dropTargetId,
      draggingNodeId,
    ]
  );

  const displayEdges = useMemo(
    () =>
      edges.map((e) => {
        const source = nodes.find((n) => n.id === e.source);
        const target = nodes.find((n) => n.id === e.target);
        const childIsLeft =
          !!source &&
          !!target &&
          target.position.x < source.position.x;
        return {
          ...e,
          hidden: hiddenNodeIds.has(e.source) || hiddenNodeIds.has(e.target),
          sourceHandle: childIsLeft ? 'out-left' : 'out-right',
          targetHandle: childIsLeft ? 'in-right' : 'in-left',
        };
      }),
    [edges, nodes, hiddenNodeIds]
  );

  return (
    <div className="w-full h-full bg-gray-50">
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onPaneClick={handlePaneClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        nodesDraggable
        nodeDragThreshold={2}
        panOnDrag
        panOnScroll={false}
        zoomOnPinch
        preventScrolling
        deleteKeyCode={null}
        className="bg-gray-50"
        minZoom={0.1}
        maxZoom={4}
        fitView
      >
        <Background gap={20} color="#e1e1e5" />
        <Controls />
        <Panel position="top-left" className="m-4 hidden md:block">
          <div className="text-xs text-gray-400 bg-white/80 p-2 rounded backdrop-blur-sm border border-gray-100 space-y-0.5">
            <p>Click: フォーカス / 再Click: ピンチイン</p>
            <p>Double Click: 編集</p>
            <p>Enter: 子ノード作成</p>
            <p>Backspace: 削除</p>
            <p>Tab: 切り替え</p>
            <p>Drag: 同じ列で並べ替え / 別ノードの上で離すと親変更</p>
            <p>コピー: タイトル・メモ・構造を保存 / ペースト: フォーカス中のノードを上書き</p>
            <p>±ボタン: 左右それぞれの子を表示/非表示</p>
          </div>
        </Panel>
      </ReactFlow>

      {editingNodeId && getNodeData(editingNodeId) && (
        <TodoModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          nodeId={editingNodeId}
          data={getNodeData(editingNodeId)!}
          onUpdate={handleUpdateNode}
        />
      )}
    </div>
  );
}

export default function RoadmapEditor(props: RoadmapEditorProps) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}
