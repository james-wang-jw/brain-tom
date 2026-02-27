import { nanoid } from 'nanoid';
import { getEmbedding, cosineSimilarity } from './embeddingStore.ts';
import type { ClusterNode } from '../types/index.ts';
import type { TOMMarker } from '../types/index.ts';

const CLUSTER_JOIN_THRESHOLD = 0.85;
const CLUSTER_FORMATION_THRESHOLD = 0.80;
const CLUSTER_UPDATE_THRESHOLD = 0.65;
const MIN_CLUSTER_SIZE = 2;

export function computeCentroid(memberIds: string[]): number[] {
  const vecs: number[][] = [];
  for (const id of memberIds) {
    const v = getEmbedding(id);
    if (v) vecs.push(v);
  }
  if (vecs.length === 0) return [];

  const dim = vecs[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }

  // L2-normalize
  let mag = 0;
  for (let i = 0; i < dim; i++) mag += sum[i] * sum[i];
  mag = Math.sqrt(mag);
  if (mag === 0) return sum;
  for (let i = 0; i < dim; i++) sum[i] /= mag;

  return sum;
}

export function recomputeClusters(
  markers: TOMMarker[],
  existingClusters: ClusterNode[],
  changedMarkerIds?: Set<string>,
): { clusters: ClusterNode[]; needsLabeling: string[] } {
  const now = Date.now();
  const markerIdSet = new Set(markers.map((m) => m.id));
  const markerLabelMap = new Map(markers.map((m) => [m.id, m.label]));
  const needsLabeling: string[] = [];

  console.group('%c[ClusterEngine] recomputeClusters', 'color: #f59e0b; font-weight: bold');
  console.log(`  Markers: ${markers.length}, Existing clusters: ${existingClusters.length}, Changed IDs: ${changedMarkerIds?.size ?? 'full'}`);

  // Phase 1 — Scope: determine which clusters to re-evaluate
  const carryForward: ClusterNode[] = [];
  const reEvaluate: ClusterNode[] = [];
  const affiliatedIds = new Set<string>();

  for (const cluster of existingClusters) {
    // Remove deleted markers
    const validMembers = cluster.memberIds.filter((id) => markerIdSet.has(id));

    if (validMembers.length < MIN_CLUSTER_SIZE) {
      console.log(`  %c[Phase 1] Dissolving cluster "${cluster.label}" — only ${validMembers.length} valid members`, 'color: #ef4444');
      continue;
    }

    const updated = { ...cluster, memberIds: validMembers };

    if (changedMarkerIds && changedMarkerIds.size > 0) {
      let shouldReEval = false;
      let maxSim = 0;
      for (const cid of changedMarkerIds) {
        const emb = getEmbedding(cid);
        if (emb && cluster.centroid.length > 0) {
          const sim = cosineSimilarity(emb, cluster.centroid);
          if (sim > maxSim) maxSim = sim;
          if (sim >= CLUSTER_UPDATE_THRESHOLD) {
            shouldReEval = true;
            break;
          }
        }
      }

      if (!shouldReEval) {
        console.log(`  %c[Phase 1] Carry forward cluster "${cluster.label}" — max sim to changed: ${(maxSim * 100).toFixed(1)}% < ${(CLUSTER_UPDATE_THRESHOLD * 100).toFixed(0)}%`, 'color: #6b7280');
        carryForward.push(updated);
        for (const id of validMembers) affiliatedIds.add(id);
        continue;
      }

      console.log(`  %c[Phase 1] Re-evaluating cluster "${cluster.label}" — max sim to changed: ${(maxSim * 100).toFixed(1)}% >= ${(CLUSTER_UPDATE_THRESHOLD * 100).toFixed(0)}%`, 'color: #f59e0b');
    }

    reEvaluate.push(updated);
  }

  // Re-evaluated clusters: recompute centroids, keep them but allow new joins
  const activeClusters: ClusterNode[] = [...carryForward];

  for (const cluster of reEvaluate) {
    const centroid = computeCentroid(cluster.memberIds);
    if (centroid.length === 0) continue;
    activeClusters.push({ ...cluster, centroid, updatedAt: now });
    for (const id of cluster.memberIds) affiliatedIds.add(id);
  }

  // Phase 2 — Assign unaffiliated markers to existing clusters
  const unaffiliated: string[] = [];
  for (const m of markers) {
    if (!affiliatedIds.has(m.id)) {
      const emb = getEmbedding(m.id);
      if (emb) unaffiliated.push(m.id);
    }
  }

  console.log(`  %c[Phase 2] Unaffiliated markers with embeddings: ${unaffiliated.length}`, 'color: #3b82f6');

  const modifiedClusterIds = new Set<string>();

  for (const markerId of [...unaffiliated]) {
    const emb = getEmbedding(markerId);
    if (!emb) continue;

    let bestCluster: ClusterNode | null = null;
    let bestSim = -1;
    const label = markerLabelMap.get(markerId) || markerId;

    for (const cluster of activeClusters) {
      if (cluster.centroid.length === 0) continue;
      const sim = cosineSimilarity(emb, cluster.centroid);
      if (sim >= CLUSTER_JOIN_THRESHOLD && sim > bestSim) {
        bestSim = sim;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      console.log(`    %c"${label}" -> join cluster "${bestCluster.label}" (sim ${(bestSim * 100).toFixed(1)}% >= ${(CLUSTER_JOIN_THRESHOLD * 100).toFixed(0)}%)`, 'color: #22c55e');
      bestCluster.memberIds.push(markerId);
      bestCluster.centroid = computeCentroid(bestCluster.memberIds);
      bestCluster.updatedAt = now;
      affiliatedIds.add(markerId);
      modifiedClusterIds.add(bestCluster.id);
      const idx = unaffiliated.indexOf(markerId);
      if (idx !== -1) unaffiliated.splice(idx, 1);
    } else if (activeClusters.length > 0) {
      // Log the best similarity even if it didn't meet threshold
      let closestSim = -1;
      let closestLabel = '';
      for (const cluster of activeClusters) {
        if (cluster.centroid.length === 0) continue;
        const sim = cosineSimilarity(emb, cluster.centroid);
        if (sim > closestSim) {
          closestSim = sim;
          closestLabel = cluster.label;
        }
      }
      console.log(`    %c"${label}" -> no cluster match (best: "${closestLabel}" at ${(closestSim * 100).toFixed(1)}% < ${(CLUSTER_JOIN_THRESHOLD * 100).toFixed(0)}%)`, 'color: #888');
    }
  }

  // Mark modified clusters as needing labeling
  for (const id of modifiedClusterIds) needsLabeling.push(id);
  // Also mark re-evaluated clusters that had member changes
  for (const cluster of reEvaluate) {
    if (!modifiedClusterIds.has(cluster.id)) {
      const orig = existingClusters.find((c) => c.id === cluster.id);
      if (orig && orig.memberIds.length !== cluster.memberIds.length) {
        needsLabeling.push(cluster.id);
      }
    }
  }

  // Phase 3 — Form new clusters from remaining singletons
  const singletons = unaffiliated.filter((id) => !affiliatedIds.has(id));

  console.log(`  %c[Phase 3] Singletons for new cluster formation: ${singletons.length}`, 'color: #8b5cf6');

  if (singletons.length >= MIN_CLUSTER_SIZE) {
    // Compute pairwise similarities
    const pairs: { i: number; j: number; sim: number }[] = [];
    for (let i = 0; i < singletons.length; i++) {
      const ei = getEmbedding(singletons[i]);
      if (!ei) continue;
      for (let j = i + 1; j < singletons.length; j++) {
        const ej = getEmbedding(singletons[j]);
        if (!ej) continue;
        const sim = cosineSimilarity(ei, ej);
        const li = markerLabelMap.get(singletons[i]) || singletons[i];
        const lj = markerLabelMap.get(singletons[j]) || singletons[j];
        const pass = sim >= CLUSTER_FORMATION_THRESHOLD;
        console.log(`    %c"${li}" <-> "${lj}": ${(sim * 100).toFixed(1)}%${pass ? ' >= ' + (CLUSTER_FORMATION_THRESHOLD * 100).toFixed(0) + '% ✓' : ''}`, pass ? 'color: #22c55e' : 'color: #888');
        if (pass) {
          pairs.push({ i, j, sim });
        }
      }
    }

    pairs.sort((a, b) => b.sim - a.sim);

    const used = new Set<number>();

    for (const { i, j } of pairs) {
      if (used.has(i) || used.has(j)) continue;

      const group = [i, j];
      used.add(i);
      used.add(j);

      // Try expanding — sort candidates by avg similarity to group so best fits join first
      let changed = true;
      while (changed) {
        changed = false;
        const candidates: { k: number; avgSim: number }[] = [];

        for (let k = 0; k < singletons.length; k++) {
          if (used.has(k)) continue;
          const ek = getEmbedding(singletons[k]);
          if (!ek) continue;

          let allAbove = true;
          let simSum = 0;
          for (const gi of group) {
            const eg = getEmbedding(singletons[gi]);
            if (!eg) { allAbove = false; break; }
            const sim = cosineSimilarity(ek, eg);
            if (sim < CLUSTER_FORMATION_THRESHOLD) { allAbove = false; break; }
            simSum += sim;
          }
          if (allAbove) {
            candidates.push({ k, avgSim: simSum / group.length });
          }
        }

        // Add best candidate first, then re-evaluate remaining
        candidates.sort((a, b) => b.avgSim - a.avgSim);
        if (candidates.length > 0) {
          const best = candidates[0];
          const lk = markerLabelMap.get(singletons[best.k]) || singletons[best.k];
          console.log(`      %c+ "${lk}" (avg sim ${(best.avgSim * 100).toFixed(1)}%)`, 'color: #22c55e');
          group.push(best.k);
          used.add(best.k);
          changed = true;
        }
      }

      if (group.length >= MIN_CLUSTER_SIZE) {
        const memberIds = group.map((idx) => singletons[idx]);
        const centroid = computeCentroid(memberIds);
        const memberLabels = memberIds.map((id) => markerLabelMap.get(id) || id);
        console.log(`    %c[New Cluster] ${memberLabels.join(', ')} (${group.length} members)`, 'color: #22c55e; font-weight: bold');
        const cluster: ClusterNode = {
          id: 'cluster-' + nanoid(),
          label: '...',
          memberIds,
          centroid,
          createdAt: now,
          updatedAt: now,
        };
        activeClusters.push(cluster);
        needsLabeling.push(cluster.id);
        for (const id of memberIds) affiliatedIds.add(id);
      } else {
        // Release indices back
        for (const idx of group) used.delete(idx);
      }
    }
  }

  console.log(`  Result: ${activeClusters.length} clusters, ${needsLabeling.length} need labeling`);
  console.groupEnd();

  return { clusters: activeClusters, needsLabeling };
}
