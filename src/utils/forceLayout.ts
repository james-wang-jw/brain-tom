import { getEmbedding, cosineSimilarity } from './embeddingStore.ts';

export interface Position {
  x: number;
  y: number;
}

export interface LayoutResult {
  positions: Map<string, Position>;
  /** How many markers had embeddings and participated in force simulation */
  embeddedCount: number;
}

/**
 * Compute 2D layout positions for markers using a spring-based force simulation.
 *
 * Every pair of nodes has an ideal distance based on their embedding similarity:
 *   idealDist = CLOSE_DIST + (1 - similarity) * (FAR_DIST - CLOSE_DIST)
 *
 * A spring force pushes/pulls each pair toward that ideal distance.
 * Very similar nodes end up close; dissimilar nodes end up far apart.
 */
export function computeLayout(
  markerIds: string[],
  existing?: Map<string, Position>,
): LayoutResult {
  const ids = markerIds.filter((id) => getEmbedding(id) !== undefined);

  if (ids.length === 0) {
    // No embeddings ready — place markers in a grid so they're visible
    const result = new Map<string, Position>();
    const cols = Math.ceil(Math.sqrt(markerIds.length));
    const spacing = 140;
    markerIds.forEach((id, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ex = existing?.get(id);
      result.set(id, ex ?? {
        x: (col - (cols - 1) / 2) * spacing,
        y: (row - (cols - 1) / 2) * spacing,
      });
    });
    return { positions: result, embeddedCount: 0 };
  }

  // Compute pairwise cosine similarity
  const n = ids.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const ei = getEmbedding(ids[i])!;
    sim[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const ej = getEmbedding(ids[j])!;
      const s = cosineSimilarity(ei, ej);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  // Initialize positions — large spread so simulation has room to work
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const spread = Math.max(600, n * 60);

  for (let i = 0; i < n; i++) {
    const ex = existing?.get(ids[i]);
    if (ex) {
      px[i] = ex.x;
      py[i] = ex.y;
    } else {
      // Place in a circle to avoid initial overlap
      const angle = (2 * Math.PI * i) / n + (Math.random() - 0.5) * 0.5;
      const radius = spread / 3;
      px[i] = Math.cos(angle) * radius;
      py[i] = Math.sin(angle) * radius;
    }
  }

  // Spring model parameters
  const CLOSE_DIST = 100;   // ideal dist for similarity = 1.0
  const FAR_DIST = 800;     // ideal dist for similarity = 0.0
  const springK = 0.004;    // spring stiffness
  const overlapK = 2000;    // strong repulsion for overlapping nodes
  const minGap = 70;        // minimum gap before overlap repulsion kicks in
  const centeringK = 0.0005;
  const damping = 0.85;
  const iterations = existing ? 150 : 400;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - (iter / iterations) * 0.7; // Cool from 1.0 to 0.3

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[i] - px[j];
        let dy = py[i] - py[j];
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.1) {
          dx = (Math.random() - 0.5) * 4;
          dy = (Math.random() - 0.5) * 4;
          dist = 2;
        }

        const nx = dx / dist;
        const ny = dy / dist;

        // Compute ideal distance from similarity
        const s = sim[i][j];
        const idealDist = CLOSE_DIST + (1 - s) * (FAR_DIST - CLOSE_DIST);

        // Spring force: pulls if dist > ideal, pushes if dist < ideal
        const displacement = dist - idealDist;
        const springForce = displacement * springK * alpha;
        // Negative springForce means nodes are too close → push apart
        // Positive springForce means nodes are too far → pull together
        vx[i] -= nx * springForce;
        vy[i] -= ny * springForce;
        vx[j] += nx * springForce;
        vy[j] += ny * springForce;

        // Hard overlap repulsion — prevent nodes from sitting on top of each other
        if (dist < minGap) {
          const overlapForce = (overlapK * alpha) / (dist * dist);
          vx[i] += nx * overlapForce;
          vy[i] += ny * overlapForce;
          vx[j] -= nx * overlapForce;
          vy[j] -= ny * overlapForce;
        }
      }
    }

    // Gentle centering
    for (let i = 0; i < n; i++) {
      vx[i] -= px[i] * centeringK * alpha;
      vy[i] -= py[i] * centeringK * alpha;
    }

    // Apply velocity with damping
    for (let i = 0; i < n; i++) {
      vx[i] *= damping;
      vy[i] *= damping;
      px[i] += vx[i];
      py[i] += vy[i];
    }
  }

  // Build result map
  const result = new Map<string, Position>();
  for (let i = 0; i < n; i++) {
    result.set(ids[i], { x: px[i], y: py[i] });
  }

  // Also include markers without embeddings near origin
  for (const id of markerIds) {
    if (!result.has(id)) {
      result.set(id, {
        x: (Math.random() - 0.5) * 150,
        y: (Math.random() - 0.5) * 150,
      });
    }
  }

  return { positions: result, embeddedCount: ids.length };
}

/**
 * Incremental layout: keep existing positions, place new nodes near their
 * most similar existing neighbor, then run a short simulation to settle.
 */
export function incrementalLayout(
  markerIds: string[],
  existing: Map<string, Position>,
  changedIds: Set<string>,
): LayoutResult {
  if (changedIds.size === 0) return { positions: existing, embeddedCount: 0 };

  const updated = new Map(existing);
  for (const newId of changedIds) {
    if (updated.has(newId)) continue;
    const newEmb = getEmbedding(newId);
    let bestSim = -1;
    let bestPos: Position = { x: (Math.random() - 0.5) * 300, y: (Math.random() - 0.5) * 300 };

    if (newEmb) {
      for (const [existId, pos] of updated) {
        if (changedIds.has(existId)) continue;
        const existEmb = getEmbedding(existId);
        if (!existEmb) continue;
        const s = cosineSimilarity(newEmb, existEmb);
        if (s > bestSim) {
          bestSim = s;
          bestPos = pos;
        }
      }
    }

    updated.set(newId, {
      x: bestPos.x + (Math.random() - 0.5) * 100,
      y: bestPos.y + (Math.random() - 0.5) * 100,
    });
  }

  return computeLayout(markerIds, updated);
}
