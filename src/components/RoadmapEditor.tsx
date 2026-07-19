import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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
import type { NodeData } from '../types';
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
/** モバイル等で交差が取れないときの近接ドロップ判定半径 (px) */
const DROP_PROXIMITY_PX = 140;

function buildChildrenMap(nodes: Node[], edges: Edge[]) {
  const childrenMap = new Map<string, string[]>();
  nodes.forEach((n) => childrenMap.set(n.id, []));
  edges.forEach((e) => {
    childrenMap.get(e.source)?.push(e.target);
  });
  return childrenMap;
}

function getHiddenNodeIds(nodes: Node<NodeData>[], edges: Edge[]) {
  const childrenMap = buildChildrenMap(nodes, edges);
  const hidden = new Set<string>();

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

  const hideDescendants = (nodeId: string) => {
    for (const childId of childrenMap.get(nodeId) || []) {
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

function getDirectChildren(nodeId: string, edges: Edge[]) {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target);
}

function findDescendantIds(nodeId: string, edges: Edge[]): Set<string> {
  const ids = new Set<string>();
  const walk = (id: string) => {
    for (const childId of getDirectChildren(id, edges)) {
      ids.add(childId);
      walk(childId);
    }
  };
  walk(nodeId);
  return ids;
}

/** 実測値があれば優先。なければタイトル行数などから推定 */
function estimateNodeHeight(node: Node<NodeData>): number {
  if (typeof node.height === 'number' && node.height > 0) {
    return node.height;
  }
  const title = node.data.title || '無題のノード';
  const charCount = [...title].length;
  // 幅280・padding込みでおおよそ13全角/行、最大2行
  const lines = Math.min(2, Math.max(1, Math.ceil(charCount / 13)));
  const titleH = lines * 22;
  const deadlineH = node.data.deadline ? 16 : 0;
  const progressH = 36;
  const paddingY = 24;
  const gap = 8;
  return paddingY + titleH + deadlineH + gap + progressH;
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

/** ドラッグ中ノードと交差／近接する、リペアレント可能なドロップ先を返す */
function pickDropTarget(
  draggedNode: Node,
  intersecting: Node[],
  edges: Edge[],
  allNodes: Node[] = []
): Node | null {
  const descendants = findDescendantIds(draggedNode.id, edges);
  const isValid = (n: Node) =>
    n.id !== draggedNode.id && !n.hidden && !descendants.has(n.id);

  let candidates = intersecting.filter(isValid);

  // タッチ操作では交差が取れないことがあるため、中心距離でも候補を拾う
  if (candidates.length === 0 && allNodes.length > 0) {
    const dragCenter = nodeCenter(draggedNode);
    const prox2 = DROP_PROXIMITY_PX * DROP_PROXIMITY_PX;
    candidates = allNodes.filter((n) => {
      if (!isValid(n)) return false;
      const c = nodeCenter(n);
      const d2 = (c.x - dragCenter.x) ** 2 + (c.y - dragCenter.y) ** 2;
      return d2 <= prox2;
    });
  }

  if (candidates.length === 0) return null;

  const dragCenter = nodeCenter(draggedNode);
  let best: Node | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const c = nodeCenter(candidate);
    const dist =
      (c.x - dragCenter.x) ** 2 + (c.y - dragCenter.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
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

  let rootId = 'root';
  if (!currentNodes.find((n) => n.id === 'root')) {
    const nodeIds = new Set(currentNodes.map((n) => n.id));
    const targetIds = new Set(currentEdges.map((e) => e.target));
    for (const id of nodeIds) {
      if (!targetIds.has(id)) {
        rootId = id;
        break;
      }
    }
  }

  const subtreeHeights = new Map<string, number>();

  const columnHeight = (childIds: string[]) => {
    let total = 0;
    childIds.forEach((childId, index) => {
      total += subtreeHeights.get(childId) || heightOf(childId);
      if (index < childIds.length - 1) total += NODE_Y_GAP;
    });
    return total;
  };

  const calculateHeight = (nodeId: string, dir: 1 | -1 = 1): number => {
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

  /**
   * @param dir 子孫を伸ばす方向（1=右, -1=左）
   */
  const setPosition = (
    nodeId: string,
    x: number,
    centerY: number,
    dir: 1 | -1 = 1
  ) => {
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

function Flow({ roadmap, onSave }: RoadmapEditorProps) {
  const isLoaded = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);

  const clickTimeoutRef = useRef<number | null>(null);
  const measuredLayoutDoneRef = useRef(false);
  const { fitView, getIntersectingNodes, getNodes } = useReactFlow();

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
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
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
      const intersecting = getIntersectingNodes(draggedNode);
      const target = pickDropTarget(
        draggedNode,
        intersecting,
        edges,
        getNodes()
      );
      setDropTargetId(target?.id ?? null);
    },
    [edges, getIntersectingNodes, getNodes]
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
        const intersecting = getIntersectingNodes(draggedNode);
        resolvedDropId =
          pickDropTarget(draggedNode, intersecting, edges, getNodes())?.id ??
          null;
      }
      setDropTargetId(null);
      setDraggingNodeId(null);

      const currentParentId = edges.find((e) => e.target === draggedNode.id)
        ?.source;

      // 別ノードへドロップ → サブツリーごとリペアレント
      if (resolvedDropId && resolvedDropId !== currentParentId) {
        const withoutOldParent = edges.filter(
          (e) => e.target !== draggedNode.id
        );
        const nextEdges = [
          ...withoutOldParent,
          makeParentEdge(resolvedDropId, draggedNode.id),
        ];

        const nextNodes = nodesWithDrag.map((n) => {
          if (n.id !== resolvedDropId) return n;
          // ドロップ先の両側を開いて見えるようにする
          return {
            ...n,
            data: expandSide(expandSide(n.data, 'left'), 'right'),
          };
        });

        const layoutedNodes = getLayoutedElements(nextNodes, nextEdges);
        setNodes(layoutedNodes);
        setEdges(nextEdges);
        setFocusedNodeId(draggedNode.id);
        return;
      }

      // 同じ親内（またはドロップなし）→ 兄弟を Y 順に並べ替え
      let nextEdges = edges;
      if (currentParentId) {
        const siblingEdges = edges.filter((e) => e.source === currentParentId);
        const otherEdges = edges.filter((e) => e.source !== currentParentId);

        const sortedSiblingEdges = [...siblingEdges].sort((a, b) => {
          const yA =
            nodesWithDrag.find((n) => n.id === a.target)?.position.y ?? 0;
          const yB =
            nodesWithDrag.find((n) => n.id === b.target)?.position.y ?? 0;
          return yA - yB;
        });

        nextEdges = [...otherEdges, ...sortedSiblingEdges];
      }

      const layoutedNodes = getLayoutedElements(nodesWithDrag, nextEdges);
      setNodes(layoutedNodes);
      if (nextEdges !== edges) {
        setEdges(nextEdges);
      }
      setFocusedNodeId(draggedNode.id);
    },
    [nodes, edges, setNodes, setEdges, getIntersectingNodes, getNodes]
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
    return () => clearClickTimeout();
  }, []);

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
            zIndex: isDragging ? 1000 : n.style?.zIndex,
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
            <p>Drag: 並べ替え / 他ノードへドロップで親変更</p>
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
