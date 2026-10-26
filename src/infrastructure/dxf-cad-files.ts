import dxfParserModule from 'dxf-parser';
import type {
  CadBlock,
  CadDrawing,
  CadFiles,
  CadLayerKind,
  CadOpening,
  CadRoom,
  CadWall,
  PlanPoint,
} from '../common/ports/cad-files.js';

// Gói CommonJS: khi import từ ESM, giá trị mặc định là chính class; file .d.ts lại khai báo kiểu ESM (`default`).
const DxfParser =
  dxfParserModule as unknown as typeof dxfParserModule.DxfParser;

/**
 * Đọc DXF dạng text bằng `dxf-parser` (logic theo demo 2D-3D: `dxfToScene.js`, `rooms.js`).
 * Layer nhận theo tên, file từ nhiều nguồn dùng được không cần sửa:
 * - tường (WALL, A-WALL, TUONG…): polyline kín là viền tường (vòng nằm trong vòng khác là lỗ), polyline hở / LINE là đường tim
 * - nội thất (FURNITURE, NOI THAT…), đèn (LIGHTING, DEN…), đồ treo tường (WALL-ITEM, DO TREO…): block INSERT
 * - cửa (DOOR, CUA), cửa sổ (WINDOW, CUASO): block INSERT, gắn vào tường gần nhất
 * Chưa làm: snap đồ treo tường vào mặt tường, xuất DXF, nhận version gốc của file.
 */
export class DxfCadFiles implements CadFiles {
  readDxf(data: Buffer, options: { wallHeight: number }): CadDrawing | null {
    const text = data.toString('utf8');
    // DXF nhị phân bắt đầu bằng "AutoCAD Binary DXF"; file text luôn có SECTION + ENTITIES
    if (
      text.startsWith('AutoCAD Binary DXF') ||
      !/^\s*SECTION\s*$/m.test(text) ||
      !/^\s*ENTITIES\s*$/m.test(text)
    ) {
      return null;
    }
    let dxf: ParsedDxf | null;
    try {
      dxf = new DxfParser().parseSync(text) as unknown as ParsedDxf | null;
    } catch {
      return null;
    }
    if (!dxf || !Array.isArray(dxf.entities)) return null;
    return toDrawing(dxf, options.wallHeight);
  }
}

// ---------- Kiểu tối thiểu của kết quả dxf-parser (thư viện khai báo kiểu rời rạc theo từng entity) ----------

interface DxfPoint {
  x: number;
  y: number;
}

interface DxfEntity {
  type: string;
  layer?: string;
  handle?: string | number;
  name?: string;
  position?: DxfPoint;
  rotation?: number;
  xScale?: number;
  yScale?: number;
  vertices?: DxfPoint[];
  center?: DxfPoint;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  shape?: boolean;
  closed?: boolean;
}

interface DxfBlock {
  entities?: DxfEntity[];
  position?: DxfPoint;
}

interface ParsedDxf {
  header?: Record<string, unknown>;
  entities: DxfEntity[];
  blocks?: Record<string, DxfBlock>;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------- Nhận layer ----------

/** `$INSUNITS` → mét trên một đơn vị bản vẽ. */
const UNIT_TO_M: Readonly<Record<number, number>> = {
  1: 0.0254,
  2: 0.3048,
  4: 0.001,
  5: 0.01,
  6: 1,
};
const DEFAULT_WALL_THICKNESS = 0.2;

const WALL_ITEM_RE = /WALL.?ITEM|WALL.?MOUNT|WALL.?HUNG|DO.?TREO|ĐỒ.?TREO/i;
const LIGHT_RE = /LIGHT|LAMP|LTG|^DEN|ĐÈN/i;
// thử sau WALL_ITEM_RE vì "WALL-ITEM" cũng chứa WALL
const WALL_RE = /WALL|TUONG|TƯỜNG|MUR/i;
const FURNITURE_RE = /FURN|NOI.?THAT|NỘI.?THẤT|FF.?E|EQUIP|DECOR|INTERIOR/i;
// "CUASO" (cửa sổ) cũng chứa "CUA" (cửa) nên thử cửa sổ trước
const WINDOW_RE = /WINDOW|WIN|CUASO|CỬA.?SỔ/i;
const DOOR_RE = /DOOR|CUA|CỬA/i;
const NOT_FURNITURE_RE =
  /DOOR|WIN|CUA|CỬA|DIM|TEXT|ANNO|TITLE|GRID|AXIS|HATCH|WALL|TUONG|TƯỜNG|LIGHT|LAMP|LTG|ĐÈN/i;

function toDrawing(dxf: ParsedDxf, wallHeight: number): CadDrawing {
  const unitCode = dxf.header?.$INSUNITS;
  const k = (typeof unitCode === 'number' && UNIT_TO_M[unitCode]) || 0.001;
  const t = DEFAULT_WALL_THICKNESS;
  const warnings: string[] = [];
  if (!unitCode) warnings.push('File không có $INSUNITS, coi đơn vị là mm.');

  const entities = dxf.entities;
  const layerOf = (e: DxfEntity) => (e.layer ?? '').toUpperCase();
  const allLayers = [...new Set(entities.map(layerOf))];

  // ----- Tường -----
  const wallLayers = allLayers.filter(
    (n) => WALL_RE.test(n) && !WALL_ITEM_RE.test(n),
  );
  if (!wallLayers.length) warnings.push('Không nhận ra layer tường.');
  const loops: PlanPoint[][] = [];
  const segments: [PlanPoint, PlanPoint][] = [];
  for (const e of entities.filter((x) => wallLayers.includes(layerOf(x)))) {
    const pts = entityPoints(e).map(([x, y]): PlanPoint => [x * k, y * k]);
    if (pts.length < 2) continue;
    if ((e.shape === true || e.closed === true) && pts.length >= 3) {
      loops.push(pts);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push([pts[i], pts[i + 1]]);
      }
    }
  }
  const walls = nestLoops(loops);
  if (!loops.length && !segments.length) {
    warnings.push('Không tìm thấy tường.');
  }

  // ----- Block -----
  const inserts = entities.filter(
    (e) => e.type === 'INSERT' && e.name && !e.name.startsWith('*'),
  );
  const insertLayers = [...new Set(inserts.map(layerOf))];
  const doorSet = insertLayers.filter(
    (n) => !WINDOW_RE.test(n) && DOOR_RE.test(n),
  );
  const windowSet = insertLayers.filter((n) => WINDOW_RE.test(n));
  const wallItemSet = insertLayers.filter((n) => WALL_ITEM_RE.test(n));
  const lightSet = insertLayers.filter(
    (n) => LIGHT_RE.test(n) && !WALL_ITEM_RE.test(n),
  );
  const special = new Set([
    ...doorSet,
    ...windowSet,
    ...wallItemSet,
    ...lightSet,
  ]);
  const furnitureSet = (
    insertLayers.some((n) => FURNITURE_RE.test(n))
      ? insertLayers.filter((n) => FURNITURE_RE.test(n))
      : insertLayers.filter((n) => !NOT_FURNITURE_RE.test(n))
  ).filter((n) => !special.has(n));

  const kindOf = (layer: string): CadLayerKind | null => {
    if (furnitureSet.includes(layer)) return 'FURNITURE';
    if (lightSet.includes(layer)) return 'LIGHTING';
    if (wallItemSet.includes(layer)) return 'WALL_ITEM';
    return null;
  };
  const handleOf = (e: DxfEntity) =>
    e.handle !== undefined && e.handle !== ''
      ? String(e.handle).toUpperCase()
      : null;

  const blocks: CadBlock[] = [];
  for (const e of inserts) {
    const layerKind = kindOf(layerOf(e));
    if (!layerKind) continue;
    const name = e.name as string;
    const b = boundsOfBlock(dxf.blocks?.[name]);
    if (!b) {
      warnings.push(`Block ${name} không có hình, bỏ qua.`);
      continue;
    }
    const sx = e.xScale ?? 1;
    const sy = e.yScale ?? 1;
    const rot = ((e.rotation ?? 0) * Math.PI) / 180;
    const cx = ((b.minX + b.maxX) / 2) * sx;
    const cy = ((b.minY + b.maxY) / 2) * sy;
    const px = e.position?.x ?? 0;
    const py = e.position?.y ?? 0;
    blocks.push({
      handle: handleOf(e),
      blockName: name,
      layer: e.layer ?? '',
      layerKind,
      x: (px + cx * Math.cos(rot) - cy * Math.sin(rot)) * k,
      y: (py + cx * Math.sin(rot) + cy * Math.cos(rot)) * k,
      rotationDeg: e.rotation ?? 0,
      widthMm: Math.round(Math.abs((b.maxX - b.minX) * sx) * k * 1000),
      depthMm: Math.round(Math.abs((b.maxY - b.minY) * sy) * k * 1000),
    });
  }
  if (blocks.some((b) => b.handle === null)) {
    warnings.push(
      'Có block không có handle: không nhận lại được món đó qua các version.',
    );
  }
  if (!blocks.some((b) => b.layerKind === 'FURNITURE')) {
    warnings.push('Không tìm thấy block nội thất (đồ phải vẽ bằng block).');
  }

  // ----- Cửa, cửa sổ: trục X của block chạy dọc tường, bề rộng = độ dài X của block × |scale| -----
  const openings: CadOpening[] = [];
  for (const [type, set] of [
    ['DOOR', doorSet],
    ['WINDOW', windowSet],
  ] as const) {
    for (const e of inserts.filter((x) => set.includes(layerOf(x)))) {
      const name = e.name as string;
      const b = boundsOfBlock(dxf.blocks?.[name]);
      if (!b) {
        warnings.push(`Block ${name} không có hình, bỏ qua.`);
        continue;
      }
      const sx = e.xScale ?? 1;
      const ang = ((e.rotation ?? 0) * Math.PI) / 180 + (sx < 0 ? Math.PI : 0);
      const width = Math.abs((b.maxX - b.minX) * sx) * k;
      const start: PlanPoint = [
        (e.position?.x ?? 0) * k,
        (e.position?.y ?? 0) * k,
      ];
      const mid: PlanPoint = [
        start[0] + (Math.cos(ang) * width) / 2,
        start[1] + (Math.sin(ang) * width) / 2,
      ];
      const d = Math.min(
        Infinity,
        ...walls.map((w) => distToWall(mid, w)),
        ...segments.map((sg) => distToSeg(mid, sg)),
      );
      const onWall = d <= t;
      const handle = handleOf(e);
      if (!onWall) {
        warnings.push(
          `${type === 'DOOR' ? 'Cửa' : 'Cửa sổ'} ${name} (handle ${handle ?? '?'}) không nằm trên tường.`,
        );
      }
      openings.push({
        handle,
        blockName: name,
        type,
        x: start[0],
        y: start[1],
        rotation: ang,
        width,
        onWall,
      });
    }
  }

  const rooms = detectRooms(walls, segments, openings, t, blocks);
  return {
    scene: {
      unitScale: k,
      wallHeight,
      wallThickness: t,
      walls,
      wallSegments: segments,
      openings,
      rooms,
      warnings,
    },
    blocks,
  };
}

// ---------- Hình học ----------

function entityPoints(e: DxfEntity): PlanPoint[] {
  if (e.vertices) return e.vertices.map((v): PlanPoint => [v.x, v.y]);
  if (!e.center || e.radius === undefined) return [];
  const { x, y } = e.center;
  const r = e.radius;
  if (e.type === 'CIRCLE') {
    return [
      [x - r, y - r],
      [x + r, y + r],
    ];
  }
  if (e.type === 'ARC') {
    // chỉ phần cung được quét: 2 đầu mút + các điểm cực (0, 90, 180, 270°) nằm trong cung.
    // Cung mở cửa không được tính cả vòng tròn, kẻo cửa rộng gấp đôi.
    const TAU = Math.PI * 2;
    const a0 = e.startAngle ?? 0;
    const sweep = ((((e.endAngle ?? 0) - a0) % TAU) + TAU) % TAU || TAU;
    const angles = [a0, a0 + sweep];
    for (let q = 0; q < 4; q++) {
      if (((((q * Math.PI) / 2 - a0) % TAU) + TAU) % TAU <= sweep) {
        angles.push((q * Math.PI) / 2);
      }
    }
    return angles.map((a): PlanPoint => [
      x + r * Math.cos(a),
      y + r * Math.sin(a),
    ]);
  }
  return [];
}

/** Khung bao của hình trong block, tính từ điểm gốc của block. */
function boundsOfBlock(block: DxfBlock | undefined): Bounds | null {
  if (!block) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of block.entities ?? []) {
    for (const [x, y] of entityPoints(e)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const base = block.position ?? { x: 0, y: 0 };
  return {
    minX: minX - base.x,
    minY: minY - base.y,
    maxX: maxX - base.x,
    maxY: maxY - base.y,
  };
}

/** Điểm trong vòng kín (chẵn-lẻ). */
function inLoop([x, y]: PlanPoint, loop: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSeg(
  [px, py]: PlanPoint,
  [[x1, y1], [x2, y2]]: [PlanPoint, PlanPoint],
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const u = len2
    ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
    : 0;
  return Math.hypot(px - x1 - u * dx, py - y1 - u * dy);
}

function distToLoop(p: PlanPoint, loop: PlanPoint[]): number {
  return Math.min(
    ...loop.map((a, i) => distToSeg(p, [a, loop[(i + 1) % loop.length]])),
  );
}

/** 0 khi điểm nằm trên phần tường (trong viền, ngoài các lỗ), ngược lại là khoảng cách tới mép tường gần nhất. */
function distToWall(p: PlanPoint, wall: CadWall): number {
  if (inLoop(p, wall.outer) && !wall.holes.some((h) => inLoop(p, h))) return 0;
  return Math.min(
    distToLoop(p, wall.outer),
    ...wall.holes.map((h) => distToLoop(p, h)),
  );
}

/**
 * Độ sâu lồng nhau quyết định vòng là gì: chẵn = tường đặc, lẻ = lỗ của vòng cha trực tiếp
 * (viền ngoài 0 > lòng phòng 1 > vách trong phòng 2). Tường thật hay chạm/cắt nhau, nên một vòng chỉ "nằm trong"
 * vòng khác khi tâm nằm trong và không đỉnh nào nằm ngoài (nằm trên cạnh vẫn tính).
 */
function nestLoops(loops: PlanPoint[][]): CadWall[] {
  const area = (l: PlanPoint[]) =>
    Math.abs(
      l.reduce((s, [x1, y1], i) => {
        const [x2, y2] = l[(i + 1) % l.length];
        return s + x1 * y2 - x2 * y1;
      }, 0),
    ) / 2;
  const centre = (l: PlanPoint[]): PlanPoint => [
    l.reduce((s, p) => s + p[0], 0) / l.length,
    l.reduce((s, p) => s + p[1], 0) / l.length,
  ];
  const onEdge = ([px, py]: PlanPoint, l: PlanPoint[]) =>
    l.some(([x1, y1], i) => {
      const [x2, y2] = l[(i + 1) % l.length];
      const cross = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
      return (
        Math.abs(cross) < 1e-9 &&
        px >= Math.min(x1, x2) - 1e-9 &&
        px <= Math.max(x1, x2) + 1e-9 &&
        py >= Math.min(y1, y2) - 1e-9 &&
        py <= Math.max(y1, y2) + 1e-9
      );
    });
  const inside = (inner: PlanPoint[], outer: PlanPoint[]) =>
    area(outer) > area(inner) &&
    inLoop(centre(inner), outer) &&
    inner.every((p) => inLoop(p, outer) || onEdge(p, outer));

  const containers = loops.map((loop, i) =>
    loops.map((_, j) => j).filter((j) => j !== i && inside(loop, loops[j])),
  );
  const depth = containers.map((c) => c.length);
  const parent = containers.map((c) =>
    c.length ? c.reduce((a, b) => (depth[b] > depth[a] ? b : a)) : -1,
  );
  const walls: CadWall[] = [];
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 0) {
      walls.push({
        outer: loop,
        holes: loops.filter((_, j) => parent[j] === i && depth[j] % 2 === 1),
      });
    }
  });
  return walls;
}

// ---------- Phòng ----------

/** Theo thứ tự ưu tiên: phòng có giường là phòng ngủ dù có bàn làm việc; phòng có sofa + bếp mở là phòng khách. */
const ROOM_KINDS: ReadonlyArray<[RegExp, string]> = [
  [/BED|GIUONG/i, 'Phòng ngủ'],
  [/WC|TOILET|BATH|SHOWER|LAVABO|BASIN/i, 'Phòng tắm'],
  [/SOFA|TV/i, 'Phòng khách'],
  [/^KC-|KITCHEN|BEP|COOK|FRIDGE|TU-LANH/i, 'Bếp'],
  [/TABLE|DINING/i, 'Phòng ăn'],
  [/DESK|BAN-LAM-VIEC/i, 'Phòng làm việc'],
];
const MIN_ROOM_AREA = 1;
const MAX_GRID_CELLS = 300_000;

/**
 * Raster hóa mặt bằng: ô bị tường / đường tim / ô cửa chặn (cửa không nối hai phòng); vùng trống chạm biên là bên ngoài;
 * mỗi vùng trống liền nhau ≥ 1 m² là một phòng. Tên lấy theo đồ bên trong, trùng tên thì đánh số.
 */
function detectRooms(
  walls: CadWall[],
  segments: [PlanPoint, PlanPoint][],
  openings: CadOpening[],
  t: number,
  blocks: CadBlock[],
): CadRoom[] {
  const pts = [...walls.flatMap((w) => w.outer), ...segments.flat()];
  if (!pts.length) return [];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let cell = 0.05;
  while (((maxX - minX) / cell) * ((maxY - minY) / cell) > MAX_GRID_CELLS) {
    cell *= 1.5;
  }
  const x0 = minX - cell;
  const y0 = minY - cell;
  const nx = Math.ceil((maxX - minX) / cell) + 3;
  const ny = Math.ceil((maxY - minY) / cell) + 3;
  const at = (i: number, j: number): PlanPoint => [
    x0 + (i + 0.5) * cell,
    y0 + (j + 0.5) * cell,
  ];

  const cuts = openings.map((o) => ({
    o,
    c: Math.cos(o.rotation),
    s: Math.sin(o.rotation),
  }));
  const blocked = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p = at(i, j);
      const b =
        walls.some(
          (w) => inLoop(p, w.outer) && !w.holes.some((h) => inLoop(p, h)),
        ) ||
        segments.some((sg) => distToSeg(p, sg) <= t / 2) ||
        cuts.some(({ o, c, s }) => {
          const dx = p[0] - o.x;
          const dy = p[1] - o.y;
          const along = dx * c + dy * s;
          const across = -dx * s + dy * c;
          return (
            along >= -cell &&
            along <= o.width + cell &&
            Math.abs(across) <= t / 2 + cell
          );
        });
      blocked[j * nx + i] = b ? 1 : 0;
    }
  }

  // đánh nhãn từng vùng trống; vùng chạm biên là bên ngoài
  const patchOf = new Int32Array(nx * ny).fill(-1);
  const rooms: { area: number; label: PlanPoint }[] = [];
  const roomOfPatch = new Map<number, number>();
  let patchCount = 0;
  for (let start = 0; start < nx * ny; start++) {
    if (blocked[start] || patchOf[start] !== -1) continue;
    const patch = patchCount++;
    const cells = [start];
    patchOf[start] = patch;
    let border = false;
    for (let q = 0; q < cells.length; q++) {
      const c = cells[q];
      const i = c % nx;
      const j = (c - i) / nx;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) border = true;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const n = b * nx + a;
        if (!blocked[n] && patchOf[n] === -1) {
          patchOf[n] = patch;
          cells.push(n);
        }
      }
    }
    const area = cells.length * cell * cell;
    if (border || area < MIN_ROOM_AREA) continue;
    // nhãn đặt ở ô gần trọng tâm nhất (luôn nằm trong phòng, kể cả phòng chữ L)
    const centres = cells.map((c) => at(c % nx, Math.floor(c / nx)));
    const cx = centres.reduce((s, q) => s + q[0], 0) / centres.length;
    const cy = centres.reduce((s, q) => s + q[1], 0) / centres.length;
    let label = centres[0];
    let best = Infinity;
    for (const q of centres) {
      const d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2;
      if (d < best) {
        best = d;
        label = q;
      }
    }
    roomOfPatch.set(patch, rooms.length);
    rooms.push({ area: Math.round(area * 100) / 100, label });
  }

  const roomAt = ([x, y]: PlanPoint) => {
    const i = Math.floor((x - x0) / cell);
    const j = Math.floor((y - y0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    return roomOfPatch.get(patchOf[j * nx + i]) ?? -1;
  };
  const votes = rooms.map(() => new Map<number, number>());
  for (const b of blocks.filter((x) => x.layerKind === 'FURNITURE')) {
    const r = roomAt([b.x, b.y]);
    if (r < 0) continue;
    const kind = ROOM_KINDS.findIndex(([re]) => re.test(b.blockName));
    if (kind >= 0) votes[r].set(kind, (votes[r].get(kind) ?? 0) + 1);
  }
  const names = votes.map((v) => {
    const first = [...v.keys()].sort((a, b) => a - b)[0];
    return first === undefined ? 'Phòng' : ROOM_KINDS[first][1];
  });
  const total: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const n of names) total[n] = (total[n] ?? 0) + 1;
  return rooms.map((room, r) => {
    const n = names[r];
    const name = total[n] > 1 ? `${n} ${(seen[n] = (seen[n] ?? 0) + 1)}` : n;
    return { name, area: room.area, label: room.label };
  });
}
