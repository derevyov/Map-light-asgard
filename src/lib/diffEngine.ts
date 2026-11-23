import type L from 'leaflet';
import {
  computeBuildingVisual,
  computeManualPointVisual,
  ResolverContext,
  VisualComputeOptions,
} from './resolver';
import { BuildingRecord, DiffLogEntry } from './types';

export interface ManagedBuilding extends BuildingRecord {
  layer: L.Path;
}

export class DiffRenderEngine {
  private lastVisualHash = new Map<string, string>();

  public clearCache(): void {
    this.lastVisualHash.clear();
  }

  public applyDiff(
    buildings: ManagedBuilding[],
    ctx: ResolverContext,
    opts: VisualComputeOptions,
    myHomeKey: string | null,
    selectedBuildingId: string | null,
    reason: string
  ): DiffLogEntry {
    let repainted = 0;

    for (const b of buildings) {
      const vis =
        b.source === 'manual' && b.manualQueue
          ? computeManualPointVisual(b.manualQueue, b.manualFeeder || '', b.key, opts)
          : computeBuildingVisual(b.street, b.house, ctx, opts);
      const isHome = Boolean(myHomeKey && b.key === myHomeKey);
      const isSelected = Boolean(selectedBuildingId && b.id === selectedBuildingId);

      const visualKey = [
        vis.color,
        vis.opacity,
        vis.dash || '',
        vis.statusText,
        vis.info?.feeder || '',
        isHome ? '1' : '0',
        isSelected ? '1' : '0',
      ].join('|');

      b.currentVisual = vis;

      if (this.lastVisualHash.get(b.id) === visualKey) {
        continue;
      }

      this.lastVisualHash.set(b.id, visualKey);
      repainted++;

      const strokeColor = isSelected
        ? '#38bdf8'
        : isHome
        ? '#ffffff'
        : vis.info?.isTransferred
        ? '#f59e0b'
        : vis.statusCode === 'unmapped'
        ? '#94a3b8'
        : vis.color;

      const weight = isSelected
        ? 3.5
        : isHome
        ? 3
        : vis.info?.isTransferred
        ? 2.2
        : vis.statusCode === 'unmapped'
        ? 1.2
        : 1.6;

      b.layer.setStyle({
        color: strokeColor,
        weight,
        fillColor: vis.color,
        fillOpacity: vis.opacity,
        dashArray: vis.dash || undefined,
      });
    }

    const total = buildings.length;
    const now = new Date();
    const time = now.toLocaleTimeString('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const message =
      repainted > 0
        ? `перефарбовано ${repainted} із ${total} будівель`
        : 'змін немає (перемальовування пропущено)';

    return {
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      time,
      reason,
      repainted,
      total,
      message,
    };
  }
}
