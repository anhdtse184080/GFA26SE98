export const CAD_FILES = Symbol('CAD_FILES');

/** Điểm trên mặt bằng `[x, y]`, mét. */
export type PlanPoint = [number, number];

/** Tường vẽ bằng polyline kín: viền ngoài + các lỗ (phòng nằm trong tường bao). */
export interface CadWall {
  outer: PlanPoint[];
  holes: PlanPoint[][];
}

export interface CadOpening {
  handle: string | null;
  blockName: string;
  type: 'DOOR' | 'WINDOW';
  /** Điểm chèn (đầu ô cửa), mét. */
  x: number;
  y: number;
  /** Hướng ô cửa chạy dọc tường, radian. */
  rotation: number;
  /** Bề rộng ô cửa, mét. */
  width: number;
  /** Cửa không nằm trên tường nào → `false` (kèm cảnh báo). */
  onWall: boolean;
}

/** Phòng tự nhận từ tường + cửa (không phải bảng `rooms`). */
export interface CadRoom {
  name: string;
  /** m² */
  area: number;
  /** Điểm đặt nhãn, luôn nằm trong phòng. */
  label: PlanPoint;
}

/** Phần bản vẽ không phải vật thể: lưu vào `design_versions.scene_json`. */
export interface CadScene {
  /** Mét trên một đơn vị bản vẽ (theo `$INSUNITS`). */
  unitScale: number;
  /** Mét. */
  wallHeight: number;
  /** Mét. */
  wallThickness: number;
  walls: CadWall[];
  /** Tường vẽ bằng đường tim (LINE / polyline hở). */
  wallSegments: [PlanPoint, PlanPoint][];
  openings: CadOpening[];
  rooms: CadRoom[];
  warnings: string[];
}

/** Nhóm layer của block: đồ nội thất, đèn, đồ treo tường. */
export type CadLayerKind = 'FURNITURE' | 'LIGHTING' | 'WALL_ITEM';

/** Một block INSERT là vật thể (thành `design_elements`). */
export interface CadBlock {
  /** Handle AutoCAD (DXF group 5), viết hoa; không có → `null`. */
  handle: string | null;
  blockName: string;
  layer: string;
  layerKind: CadLayerKind;
  /** Tâm footprint, mét. */
  x: number;
  y: number;
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
}

export interface CadDrawing {
  scene: CadScene;
  blocks: CadBlock[];
}

/** Đọc file CAD. Hàm thuần, không I/O ngoài; gọi trước khi lưu file. */
export interface CadFiles {
  /** Không phải DXF dạng text đọc được → `null`. */
  readDxf(data: Buffer, options: { wallHeight: number }): CadDrawing | null;
}
