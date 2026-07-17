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

const X_OFFSET = 400;
const MIN_Y_GAP = 160;
const CLICK_DELAY_MS = 250;

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

  const hideDescendants = (nodeId: string) => {
    for (const childId of childrenMap.get(nodeId) || []) {
      hidden.add(childId);
      hideDescendants(childId);
    }
  };

  nodes.forEach((n) => {
    if (n.data.collapsed) {
      hideDescendants(n.id);
    }
  });

  return hidden;
}

function getDirectChildren(nodeId: string, edges: Edge[]) {
  return edges.filter((e) => e.source === nodeId).map((e) => e.target);
}

function getLayoutedElements(currentNodes: Node<NodeData>[], currentEdges: Edge[]) {
  if (currentNodes.length === 0) return currentNodes;

  const childrenMap = buildChildrenMap(currentNodes, currentEdges);

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

  const calculateHeight = (nodeId: string): number => {
    const node = currentNodes.find((n) => n.id === nodeId);
    const children = node?.data.collapsed ? [] : childrenMap.get(nodeId) || [];

    if (children.length === 0) {
      const height = MIN_Y_GAP;
      subtreeHeights.set(nodeId, height);
      return height;
    }

    let totalHeight = 0;
    children.forEach((childId) => {
      totalHeight += calculateHeight(childId);
    });
    subtreeHeights.set(nodeId, totalHeight);
    return totalHeight;
  };

  calculateHeight(rootId);

  const newPositions = new Map<string, { x: number; y: number }>();
  const setPosition = (nodeId: string, x: number, yTop: number) => {
    const node = currentNodes.find((n) => n.id === nodeId);
    const children = node?.data.collapsed ? [] : childrenMap.get(nodeId) || [];
    const myHeight = subtreeHeights.get(nodeId) || MIN_Y_GAP;
    const myY = yTop + myHeight / 2;

    newPositions.set(nodeId, { x, y: myY });

    let currentY = yTop;
    children.forEach((childId) => {
      const childHeight = subtreeHeights.get(childId) || MIN_Y_GAP;
      setPosition(childId, x + X_OFFSET, currentY);
      currentY += childHeight;
    });
  };

  const rootHeight = subtreeHeights.get(rootId) || MIN_Y_GAP;
  setPosition(rootId, 0, -rootHeight / 2);

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
  if (data.collapsed !== undefined) rest.collapsed = data.collapsed;
  return rest;
}

function Flow({ roadmap, onSave }: RoadmapEditorProps) {
  const isLoaded = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

  const clickTimeoutRef = useRef<number | null>(null);
  const { fitView } = useReactFlow();

  // Load data
  useEffect(() => {
    setNodes(roadmap.nodes);
    setEdges(roadmap.edges);
    setFocusedNodeId(null);
    setTimeout(() => fitView({ duration: 800 }), 100);
    isLoaded.current = true;
  }, [roadmap.id]);

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
    (nodeId: string) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } }
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

  // ドラッグ終了時: 同親の兄弟を Y 座標順に並べ替え、ツリーを自動整頓する
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, draggedNode: Node) => {
      const nodesWithDrag = nodes.map((n) =>
        n.id === draggedNode.id
          ? { ...n, position: { ...draggedNode.position } }
          : n
      );

      const parentEdge = edges.find((e) => e.target === draggedNode.id);
      let nextEdges = edges;

      if (parentEdge) {
        const parentId = parentEdge.source;
        const siblingEdges = edges.filter((e) => e.source === parentId);
        const otherEdges = edges.filter((e) => e.source !== parentId);

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
    [nodes, edges, setNodes, setEdges]
  );

  const handleUpdateNode = useCallback(
    (id: string, newData: NodeData) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === id) {
            const cleaned = stripUiMeta(newData);
            const nextData: NodeData = {
              ...node.data,
              ...cleaned,
              collapsed: node.data.collapsed,
              // undefined のときも明示的に消し、旧メモが残らないようにする
              memo: cleaned.memo,
            };
            if (!nextData.memo) {
              delete nextData.memo;
            }
            return { ...node, data: nextData };
          }
          return node;
        })
      );
    },
    [setNodes]
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

    // Expanding parent if it was collapsed so the new child is visible
    const nextNodes = [
      ...nodes.map((n) => ({
        ...n,
        selected: false,
        data:
          n.id === parentId && n.data.collapsed
            ? { ...n.data, collapsed: false }
            : n.data,
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
        return {
          ...n,
          hidden: hiddenNodeIds.has(n.id),
          selected: n.id === focusedNodeId || !!n.selected,
          data: {
            ...n.data,
            hasChildren: childIds.length > 0,
            childCount: childIds.length,
            onToggleCollapse: handleToggleCollapse,
          },
        };
      }),
    [nodes, childrenMap, hiddenNodeIds, focusedNodeId, handleToggleCollapse]
  );

  const displayEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        hidden: hiddenNodeIds.has(e.source) || hiddenNodeIds.has(e.target),
      })),
    [edges, hiddenNodeIds]
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
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
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
            <p>Drag: 並べ替え（自動整頓）</p>
            <p>±ボタン: 子ノード表示/非表示</p>
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
