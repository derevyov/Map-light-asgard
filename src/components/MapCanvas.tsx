import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import googleExtraPointsData from '../../data/google_extra_points.json';
import { DiffRenderEngine, ManagedBuilding } from '../lib/diffEngine';
import { fetchOsmBuildings } from '../lib/osmCache';
import { normalizeHouse, normalizeStreet } from '../lib/parser';
import { ResolverContext, VisualComputeOptions } from '../lib/resolver';
import {
  BuildingRecord,
  DiffLogEntry,
  GoogleExtraPoint,
  ManualPoint,
} from '../lib/types';
import { Layers, Loader2, LocateFixed, MapPinPlus, X } from 'lucide-react';

const CITY_CENTER: [number, number] = [47.82532, 31.1665];
const CITY_ZOOM = 14;

export interface MapCanvasHandle {
  flyToBuilding: (buildingId: string) => void;
  flyToFavorite: (key: string, lat: number, lng: number) => void;
  flyToCoords: (lat: number, lng: number, buildingId?: string) => void;
  resetView: () => void;
  reloadOsm: () => Promise<void>;
  forceRepaint: (reason: string) => void;
}

interface MapCanvasProps {
  theme: 'dark' | 'light';
  resolverCtx: ResolverContext;
  visualOpts: VisualComputeOptions;
  myHomeKey: string | null;
  selectedBuildingId: string | null;
  manualPoints: ManualPoint[];
  pickMode: boolean;
  onTogglePickMode: () => void;
  onPickCoords: (coords: { lat: number; lng: number }) => void;
  renderTriggerReason: string;
  renderRevision: number;
  onBuildingsLoaded: (
    buildings: BuildingRecord[],
    stats: { osmCount: number; googleCount: number; substationCount: number; fromCache: boolean }
  ) => void;
  onSelectBuilding: (building: BuildingRecord | null) => void;
  onDiffResult: (entry: DiffLogEntry) => void;
  onOsmError: (msg: string) => void;
}

export const MapCanvas = React.forwardRef<MapCanvasHandle, MapCanvasProps>(
  (
    {
      theme,
      resolverCtx,
      visualOpts,
      myHomeKey,
      selectedBuildingId,
      manualPoints,
      pickMode,
      onTogglePickMode,
      onPickCoords,
      renderTriggerReason,
      renderRevision,
      onBuildingsLoaded,
      onSelectBuilding,
      onDiffResult,
      onOsmError,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const tileLayerRef = useRef<L.TileLayer | null>(null);
    const buildingsLayerGroupRef = useRef<L.LayerGroup | null>(null);
    const manualLayerGroupRef = useRef<L.LayerGroup | null>(null);
    const substationsLayerGroupRef = useRef<L.LayerGroup | null>(null);
    const baseBuildingsRef = useRef<ManagedBuilding[]>([]);
    const manualManagedRef = useRef<ManagedBuilding[]>([]);
    const diffEngineRef = useRef<DiffRenderEngine>(new DiffRenderEngine());

    const [mapDarkOverride, setMapDarkOverride] = useState<boolean | null>(null);
    const [cartoEnabled, setCartoEnabled] = useState<boolean>(false);
    const [loadingOsm, setLoadingOsm] = useState<boolean>(true);
    const [legendOpen, setLegendOpen] = useState<boolean>(() =>
      typeof window !== 'undefined' ? window.innerWidth >= 640 : true
    );

    const isMapDark = mapDarkOverride !== null ? mapDarkOverride : theme === 'dark';

    useEffect(() => {
      let active = true;
      fetch('/api/tiles/status')
        .then((r) => (r.ok ? r.json() : { cartoEnabled: false }))
        .then((d: { cartoEnabled?: boolean }) => {
          if (active && d?.cartoEnabled) setCartoEnabled(true);
        })
        .catch(() => {
          // Use free OSM tiles
        });
      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      setMapDarkOverride(null);
    }, [theme]);

    const latestCtxRef = useRef(resolverCtx);
    const latestOptsRef = useRef(visualOpts);
    const latestHomeRef = useRef(myHomeKey);
    const latestSelectedRef = useRef(selectedBuildingId);
    const latestPickModeRef = useRef(pickMode);
    const onSelectRef = useRef(onSelectBuilding);
    const onDiffRef = useRef(onDiffResult);
    const onPickCoordsRef = useRef(onPickCoords);

    latestCtxRef.current = resolverCtx;
    latestOptsRef.current = visualOpts;
    latestHomeRef.current = myHomeKey;
    latestSelectedRef.current = selectedBuildingId;
    latestPickModeRef.current = pickMode;
    onSelectRef.current = onSelectBuilding;
    onDiffRef.current = onDiffResult;
    onPickCoordsRef.current = onPickCoords;

    const getAllManaged = () => [...baseBuildingsRef.current, ...manualManagedRef.current];

    const runDiff = (reason: string) => {
      const all = getAllManaged();
      if (all.length === 0) return;
      const entry = diffEngineRef.current.applyDiff(
        all,
        latestCtxRef.current,
        latestOptsRef.current,
        latestHomeRef.current,
        latestSelectedRef.current,
        reason
      );
      onDiffRef.current(entry);

      if (latestSelectedRef.current) {
        const found = all.find((b) => b.id === latestSelectedRef.current);
        if (found) {
          onSelectRef.current({ ...found });
        }
      }
    };

    const populateMapLayers = async (forceRefresh: boolean) => {
      const map = mapRef.current;
      const bGroup = buildingsLayerGroupRef.current;
      const sGroup = substationsLayerGroupRef.current;
      if (!map || !bGroup || !sGroup) return;

      setLoadingOsm(true);
      bGroup.clearLayers();
      sGroup.clearLayers();
      baseBuildingsRef.current = [];
      diffEngineRef.current.clearCache();

      let osmCount = 0;
      let substationCount = 0;
      let fromCache = false;

      try {
        const res = await fetchOsmBuildings(forceRefresh);
        fromCache = res.fromCache;
        const nodes: Record<number, [number, number]> = {};
        for (const el of res.data.elements) {
          if (el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number') {
            nodes[el.id] = [el.lat, el.lon];
          }
        }

        for (const el of res.data.elements) {
          if (el.type !== 'way') continue;
          const coords: [number, number][] = Array.isArray(el.geometry) && el.geometry.length >= 3
            ? el.geometry.map((pt) => [pt.lat, pt.lon])
            : Array.isArray(el.nodes)
            ? el.nodes.map((id) => nodes[id]).filter(Boolean)
            : [];
          if (coords.length < 3) continue;

          if (el.tags?.power === 'substation') {
            substationCount++;
            const subPoly = L.polygon(coords, {
              color: '#eab308',
              weight: 2,
              fillColor: '#ca8a04',
              fillOpacity: 0.28,
            });
            const popupEl = document.createElement('div');
            const title = document.createElement('strong');
            title.textContent = el.tags?.name || 'Підстанція ТП / ПС';
            const sub = document.createElement('div');
            sub.style.fontSize = '11px';
            sub.style.opacity = '0.75';
            sub.textContent = 'Обʼєкт електромережі OSM (power=substation)';
            popupEl.appendChild(title);
            popupEl.appendChild(sub);
            subPoly.bindPopup(popupEl);
            subPoly.addTo(sGroup);
            continue;
          }

          const street = el.tags?.['addr:street'] || '';
          const house = el.tags?.['addr:housenumber'] || '';
          if (!house) continue;

          const key = `${normalizeStreet(street)}|${normalizeHouse(house)}`;
          const poly = L.polygon(coords, {
            color: '#64748b',
            weight: 1,
            fillColor: '#64748b',
            fillOpacity: 0.22,
          });
          const center = poly.getBounds().getCenter();
          const managed: ManagedBuilding = {
            id: `osm_${el.id}`,
            key,
            street,
            house,
            source: 'osm',
            lat: center.lat,
            lng: center.lng,
            layer: poly,
          };
          poly.on('click', (ev) => {
            if (latestPickModeRef.current) {
              L.DomEvent.stopPropagation(ev);
              onPickCoordsRef.current({ lat: ev.latlng.lat, lng: ev.latlng.lng });
              return;
            }
            onSelectRef.current({ ...managed });
          });
          poly.addTo(bGroup);
          baseBuildingsRef.current.push(managed);
          osmCount++;
        }
      } catch (err) {
        onOsmError(
          err instanceof Error
            ? err.message
            : 'Не вдалося завантажити OSM Overpass — показано точки Google Maps'
        );
      }

      const extraPoints = googleExtraPointsData as GoogleExtraPoint[];
      for (const pt of extraPoints) {
        const key = `${normalizeStreet(pt.street)}|${normalizeHouse(pt.house)}`;
        const circle = L.circleMarker([pt.lat, pt.lng], {
          radius: 7,
          color: '#64748b',
          weight: 1.5,
          fillColor: '#64748b',
          fillOpacity: 0.72,
        });
        const managed: ManagedBuilding = {
          id: pt.id,
          key,
          street: pt.street,
          house: pt.house,
          label: pt.label,
          source: 'google',
          lat: pt.lat,
          lng: pt.lng,
          layer: circle,
        };
        circle.on('click', (ev) => {
          if (latestPickModeRef.current) {
            L.DomEvent.stopPropagation(ev);
            onPickCoordsRef.current({ lat: ev.latlng.lat, lng: ev.latlng.lng });
            return;
          }
          onSelectRef.current({ ...managed });
        });
        circle.addTo(bGroup);
        baseBuildingsRef.current.push(managed);
      }

      onBuildingsLoaded(
        baseBuildingsRef.current.map(({ layer: _layer, ...rest }) => rest),
        {
          osmCount,
          googleCount: extraPoints.length,
          substationCount,
          fromCache,
        }
      );

      setLoadingOsm(false);
      runDiff(
        osmCount > 0
          ? fromCache
            ? 'Завантажено OSM з кешу + Google точки'
            : 'Завантажено OSM Overpass + Google точки'
          : 'Завантажено шар Google точок'
      );
    };

    // Initialize Leaflet map once
    useEffect(() => {
      if (!containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: CITY_CENTER,
        zoom: CITY_ZOOM,
        zoomControl: true,
        preferCanvas: true,
      });

      const initialTile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      tileLayerRef.current = initialTile;

      const sGroup = L.layerGroup().addTo(map);
      const bGroup = L.layerGroup().addTo(map);
      const mGroup = L.layerGroup().addTo(map);
      substationsLayerGroupRef.current = sGroup;
      buildingsLayerGroupRef.current = bGroup;
      manualLayerGroupRef.current = mGroup;
      mapRef.current = map;

      map.on('click', (ev: L.LeafletMouseEvent) => {
        if (latestPickModeRef.current) {
          onPickCoordsRef.current({ lat: ev.latlng.lat, lng: ev.latlng.lng });
        }
      });

      let resizeRafId: number | null = null;
      const resizeObserver =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver((entries) => {
              const rect = entries[0]?.contentRect;
              if (!rect || rect.width === 0 || rect.height === 0) return;
              if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
              resizeRafId = requestAnimationFrame(() => {
                resizeRafId = null;
                map.invalidateSize({ animate: false });
              });
            })
          : null;
      if (resizeObserver && containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      void populateMapLayers(false);

      return () => {
        if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
        resizeObserver?.disconnect();
        map.remove();
        mapRef.current = null;
      };
    }, []);

    // Sync user-pinned manual points layer dynamically
    useEffect(() => {
      const mGroup = manualLayerGroupRef.current;
      if (!mGroup) return;

      mGroup.clearLayers();
      manualManagedRef.current = [];

      for (const mp of manualPoints) {
        const marker = L.circleMarker([mp.lat, mp.lng], {
          radius: 8,
          color: '#38bdf8',
          weight: 2.5,
          fillColor: '#22c55e',
          fillOpacity: 0.85,
        });
        const managed: ManagedBuilding = {
          id: mp.id,
          key: `manual|${mp.id}`,
          street: mp.label,
          house: '',
          label: mp.label,
          source: 'manual',
          manualQueue: mp.queue,
          manualFeeder: mp.feeder,
          manualNote: mp.note,
          lat: mp.lat,
          lng: mp.lng,
          layer: marker,
        };
        marker.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          if (latestPickModeRef.current) {
            onPickCoordsRef.current({ lat: ev.latlng.lat, lng: ev.latlng.lng });
            return;
          }
          onSelectRef.current({ ...managed });
        });
        marker.addTo(mGroup);
        manualManagedRef.current.push(managed);
      }

      runDiff('Оновлено вказані точки');
    }, [manualPoints]);

    // Switch base tiles: CARTO server-side proxy (when CARTO_API_KEY secret is set) OR free OSM + CSS dark filter
    useEffect(() => {
      const map = mapRef.current;
      const el = containerRef.current;
      if (!map || !el) return;

      if (cartoEnabled) {
        el.classList.remove('osm-dark-tiles');
        if (tileLayerRef.current) {
          map.removeLayer(tileLayerRef.current);
        }
        const stylePath = isMapDark ? 'dark_all' : 'voyager';
        const nextTile = L.tileLayer(`/api/tiles/${stylePath}/{z}/{x}/{y}`, {
          maxZoom: 19,
          attribution:
            '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
        });
        nextTile.addTo(map);
        nextTile.bringToBack();
        tileLayerRef.current = nextTile;
      } else {
        if (isMapDark) {
          el.classList.add('osm-dark-tiles');
        } else {
          el.classList.remove('osm-dark-tiles');
        }
      }
    }, [cartoEnabled, isMapDark]);

    // Trigger DiffRenderEngine on every state/time/filter/data change
    useEffect(() => {
      if (getAllManaged().length === 0) return;
      runDiff(renderTriggerReason);
    }, [renderRevision, selectedBuildingId, myHomeKey]);

    useImperativeHandle(ref, () => ({
      flyToBuilding(buildingId: string) {
        const map = mapRef.current;
        const found = getAllManaged().find((b) => b.id === buildingId);
        if (!map || !found) return;
        map.flyTo([found.lat, found.lng], 17, { duration: 0.65 });
        onSelectRef.current({ ...found });
      },
      flyToFavorite(key: string, lat: number, lng: number) {
        const map = mapRef.current;
        if (!map) return;
        const found = getAllManaged().find((b) => b.key === key);
        if (found) {
          map.flyTo([found.lat, found.lng], 17, { duration: 0.65 });
          onSelectRef.current({ ...found });
        } else {
          map.flyTo([lat, lng], 17, { duration: 0.65 });
        }
      },
      flyToCoords(lat: number, lng: number, buildingId?: string) {
        const map = mapRef.current;
        if (!map) return;
        map.flyTo([lat, lng], 17, { duration: 0.65 });
        if (buildingId) {
          const found = getAllManaged().find((b) => b.id === buildingId);
          if (found) onSelectRef.current({ ...found });
        }
      },
      resetView() {
        mapRef.current?.flyTo(CITY_CENTER, CITY_ZOOM, { duration: 0.5 });
      },
      async reloadOsm() {
        await populateMapLayers(true);
      },
      forceRepaint(reason: string) {
        diffEngineRef.current.clearCache();
        runDiff(reason);
      },
    }));

    return (
      <div
        className={`relative flex-1 h-full min-w-0 bg-slate-200 dark:bg-[#0b1120] ${
          pickMode ? 'pick-mode-active' : ''
        }`}
      >
        <div ref={containerRef} className="w-full h-full z-0" />

        {/* Pick Point Mode Banner */}
        {pickMode && (
          <div className="absolute top-16 sm:top-14 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-1.5rem)] sm:w-auto max-w-md flex items-center justify-between gap-2.5 px-3.5 py-2 bg-sky-600 text-white rounded-md shadow-xl text-xs font-medium">
            <div className="flex items-center gap-2 min-w-0">
              <MapPinPlus className="w-4 h-4 shrink-0" />
              <span className="leading-snug">
                Натисніть у будь-якому місці карти, щоб вказати точку без адреси
              </span>
            </div>
            <button
              type="button"
              onClick={onTogglePickMode}
              className="p-1 rounded hover:bg-sky-500 transition-colors shrink-0"
              aria-label="Скасувати режим вибору точки"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Loading Overlay */}
        {loadingOsm && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-2 px-3.5 py-2 bg-white/95 dark:bg-[#111827]/95 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg text-xs text-slate-800 dark:text-slate-200">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600 dark:text-sky-400" />
            <span>Завантаження контурів будівель OpenStreetMap…</span>
          </div>
        )}

        {/* Map Utility Controls */}
        <div className="absolute top-3 left-14 right-2 sm:right-auto z-[900] flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMapDarkOverride(!isMapDark)}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 bg-white/95 dark:bg-[#111827]/95 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium text-slate-800 dark:text-slate-200 shadow transition-colors whitespace-nowrap"
            title="Перемкнути підкладку карти"
          >
            <Layers className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span className="hidden xs:inline sm:inline">
              {cartoEnabled
                ? isMapDark
                  ? 'CARTO темна'
                  : 'CARTO Voyager'
                : isMapDark
                ? 'OSM темна'
                : 'OSM світла'}
            </span>
          </button>

          <button
            type="button"
            onClick={onTogglePickMode}
            className={`flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 border rounded text-xs font-medium shadow transition-colors whitespace-nowrap ${
              pickMode
                ? 'bg-sky-600 border-sky-500 text-white'
                : 'bg-white/95 dark:bg-[#111827]/95 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200'
            }`}
            title="Не знаєте адресу? Вкажіть будь-яку точку на карті"
          >
            <MapPinPlus className="w-3.5 h-3.5" />
            <span>{pickMode ? 'Скасувати' : 'Вказати точку'}</span>
          </button>

          <button
            type="button"
            onClick={() => mapRef.current?.flyTo(CITY_CENTER, CITY_ZOOM, { duration: 0.45 })}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 bg-white/95 dark:bg-[#111827]/95 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-xs font-medium text-slate-800 dark:text-slate-200 shadow transition-colors whitespace-nowrap"
            title="Центрувати на Південноукраїнськ"
          >
            <LocateFixed className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            <span className="hidden sm:inline">Центр</span>
          </button>
        </div>

        {/* Bottom-Left Map Legend */}
        <div className="absolute bottom-4 left-3 z-[900] bg-white/94 dark:bg-[#111827]/92 backdrop-blur-sm border border-slate-200 dark:border-slate-700/90 rounded-lg text-xs text-slate-800 dark:text-slate-200 shadow-xl max-w-[270px]">
          <button
            type="button"
            onClick={() => setLegendOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-4 px-3 py-2 font-semibold text-slate-900 dark:text-slate-200 hover:text-sky-700 dark:hover:text-white transition-colors"
          >
            <span>Легенда статусів</span>
            <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400">
              {legendOpen ? 'Згорнути' : 'Показати'}
            </span>
          </button>

          {legendOpen && (
            <div className="px-3 pb-2.5 pt-1 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-[11px] text-slate-700 dark:text-slate-300">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#ef4444]" />
                <span>Відключено (код 2)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#f97316]" />
                <span>Перемикання ±30 хв (коди 1, 3)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#eab308]" />
                <span>Можливе відключення (код 4)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#a855f7]" />
                <span>2 черги: 1 відкл. / 1 вкл. (підʼїзди)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#38bdf8]" />
                <span>Квартири відкл., ліфти працюють</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#22c55e]" />
                <span>Світло є (код 0)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-[3px] shrink-0 bg-[#64748b]" />
                <span>Немає в таблиці ДПЕМ</span>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-slate-200 dark:border-slate-800/80">
                <span className="w-3 h-3 rounded-[3px] shrink-0 border-2 border-dashed border-amber-500" />
                <span>Тимчасовий перенос фідера</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full shrink-0 border-2 border-sky-400 bg-emerald-500/80" />
                <span>Вказана точка / Google добір</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

MapCanvas.displayName = 'MapCanvas';
