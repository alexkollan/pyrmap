import { haversineDistanceKm } from '@pyrmap/shared';

interface LocatedItem {
  latitude: number;
  longitude: number;
}

/** Groups items where each is within maxDistanceKm of at least one other item in its group (transitive). */
export function clusterByDistance<T extends LocatedItem>(items: T[], maxDistanceKm: number): T[][] {
  const parent = items.map((_, i) => i);

  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const distanceKm = haversineDistanceKm(
        items[i]!.latitude,
        items[i]!.longitude,
        items[j]!.latitude,
        items[j]!.longitude,
      );
      if (distanceKm <= maxDistanceKm) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const group = groups.get(root);
    if (group) {
      group.push(items[i]!);
    } else {
      groups.set(root, [items[i]!]);
    }
  }
  return [...groups.values()];
}
