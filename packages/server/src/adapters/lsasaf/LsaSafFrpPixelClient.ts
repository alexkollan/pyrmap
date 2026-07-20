import type { FireAlert, FireAlertSource } from '../../ports/FireAlertSource.js';
import { parseFrpPixelList } from './frpPixelParser.js';

const DATA_SERVER_BASE = 'https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MSG/FRP-PIXEL/HDF5';
const SLOT_MINUTES = 15;
const TIMEOUT_MS = 30_000;

type FetchFn = typeof fetch;

/**
 * Pulls the LSA SAF MSG SEVIRI FRP-PIXEL "ListProduct": a full-disc, no-threshold list of every
 * detected fire pixel every 15 minutes, over plain HTTPS with HTTP Basic Auth. Distinct from the
 * EUMETSAT CAP alert bulletin (EumetsatFciClient), which applies its own undocumented significance
 * threshold that empirically misses small fires in Greece — verified live 2026-07-20, see
 * docs/DECISIONS.md. `count` slots are tried working backward from "now"; a 404 means that slot
 * hasn't been published yet (normal at the live edge) and is skipped, not an error.
 */
export class LsaSafFrpPixelClient implements FireAlertSource {
  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  async fetchRecentAlerts(count: number): Promise<FireAlert[]> {
    const alerts: FireAlert[] = [];
    for (const slot of this.recentSlots(count)) {
      const buffer = await this.downloadSlot(slot);
      if (!buffer) continue;
      const circles = await parseFrpPixelList(buffer);
      alerts.push({ productId: `MSG_FRP_PIXEL_${slot}`, acquiredAt: slotToIso(slot), circles });
    }
    return alerts;
  }

  private recentSlots(count: number): string[] {
    const now = this.nowFn();
    const flooredMinutes = Math.floor(now.getUTCMinutes() / SLOT_MINUTES) * SLOT_MINUTES;
    const latest = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), flooredMinutes);
    const slots: string[] = [];
    for (let i = 0; i < count; i++) {
      slots.push(formatSlot(new Date(latest - i * SLOT_MINUTES * 60_000)));
    }
    return slots;
  }

  private async downloadSlot(slot: string): Promise<Buffer | null> {
    const year = slot.slice(0, 4);
    const month = slot.slice(4, 6);
    const day = slot.slice(6, 8);
    const filename = `HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_${slot}`;
    const url = `${DATA_SERVER_BASE}/${year}/${month}/${day}/${filename}`;
    const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Basic ${basic}` },
        signal: controller.signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`LSA SAF request failed: HTTP ${response.status} for ${filename}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function formatSlot(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** "202607200300" -> "2026-07-20T03:00:00Z" */
function slotToIso(slot: string): string {
  const year = slot.slice(0, 4);
  const month = slot.slice(4, 6);
  const day = slot.slice(6, 8);
  const hour = slot.slice(8, 10);
  const minute = slot.slice(10, 12);
  return `${year}-${month}-${day}T${hour}:${minute}:00Z`;
}
