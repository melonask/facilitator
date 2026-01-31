import type { DiscoveryItem } from "./types";

const usedNonces = new Set<string>();

export const nonceManager = {
  checkAndMark(nonce: string): boolean {
    if (usedNonces.has(nonce)) return false;
    usedNonces.add(nonce);
    return true;
  },

  has(nonce: string): boolean {
    return usedNonces.has(nonce);
  },

  reset(): void {
    usedNonces.clear();
  },
};

const catalog = new Map<string, DiscoveryItem>();

export const bazaarManager = {
  upsert(item: DiscoveryItem): void {
    catalog.set(item.resource, item);
  },

  list(limit = 20, offset = 0) {
    const allItems = Array.from(catalog.values()).sort(
      (a, b) =>
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
    );

    return {
      items: allItems.slice(offset, offset + limit),
      total: allItems.length,
    };
  },

  reset(): void {
    catalog.clear();
  },
};
