import type { Product } from '../../products/entities/product.entity.js';
import type {
  CommentThread,
  VersionComments,
} from '../design-comments.service.js';
import type {
  ComparedElement,
  ProductOption,
  ProductOptions,
  VersionComparison,
} from '../design-products.service.js';
import { ProductSelection } from '../entities/product-selection.entity.js';
import type {
  RevisionLimit,
  StageVersions,
  VersionDetail,
} from '../designs.service.js';
import type {
  Comment,
  CommentKind,
  CommentStatus,
  PinPosition,
} from '../entities/comment.entity.js';
import type {
  DesignElement,
  DesignElementType,
  ElementPosition,
  ProductFit,
} from '../entities/design-element.entity.js';
import type {
  DesignSourceType,
  DesignVersion,
  DesignVersionStatus,
  DesignVersionType,
  RevisionType,
} from '../entities/design-version.entity.js';
import type {
  RevisionRequest,
  RevisionRequestStatus,
} from '../entities/revision-request.entity.js';

export class UserRefDto {
  id: string;
  fullName: string;
}

export class DesignVersionResponseDto {
  id: string;
  projectId: string;
  versionType: DesignVersionType;
  versionNo: number;
  /** Nhãn hiển thị theo giai đoạn: v1, v1.1, v2… */
  label: string;
  revisionType: RevisionType | null;
  sourceType: DesignSourceType;
  status: DesignVersionStatus;
  title: string;
  description: string | null;
  parentVersionId: string | null;
  createdBy: UserRefDto;
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;

  /** `version` phải được tải kèm `createdBy`. */
  static from(version: DesignVersion, label: string): DesignVersionResponseDto {
    const creator = version.createdBy;
    if (!creator)
      throw new Error('DesignVersion must be loaded with createdBy');
    return Object.assign(new DesignVersionResponseDto(), {
      id: version.id,
      projectId: version.projectId,
      versionType: version.versionType,
      versionNo: version.versionNo,
      label,
      revisionType: version.revisionType,
      sourceType: version.sourceType,
      status: version.status,
      title: version.title,
      description: version.description,
      parentVersionId: version.parentVersionId,
      createdBy: { id: creator.id, fullName: creator.fullName },
      submittedAt: version.submittedAt,
      approvedAt: version.approvedAt,
      createdAt: version.createdAt,
    });
  }
}

export class RevisionLimitDto {
  /** Số bản MAJOR tối đa của giai đoạn */
  limit: number;
  used: number;
  remaining: number;

  static from(limit: RevisionLimit): RevisionLimitDto {
    return Object.assign(new RevisionLimitDto(), limit);
  }
}

export class DesignVersionListResponseDto {
  /** Cũ trước */
  items: DesignVersionResponseDto[];
  revisionLimit: RevisionLimitDto;

  static from(stage: StageVersions): DesignVersionListResponseDto {
    return Object.assign(new DesignVersionListResponseDto(), {
      items: stage.versions.map((v) =>
        DesignVersionResponseDto.from(v, stage.labels.get(v.id) ?? ''),
      ),
      revisionLimit: RevisionLimitDto.from(stage.revisionLimit),
    });
  }
}

export class CategoryRefDto {
  id: string;
  code: string;
  name: string;
}

export class SupplierRefDto {
  /** `user_id` của supplier */
  id: string;
  companyName: string;
}

/** Sản phẩm thật đã chọn cho món (giá là snapshot lúc chọn). */
export class ElementSelectionResponseDto {
  productId: string;
  name: string;
  sku: string;
  blockCode: string;
  supplier: SupplierRefDto;
  quantity: string;
  /** VND, giá lúc chọn */
  unitPriceSnapshot: string;
  /** quantity × unitPriceSnapshot */
  lineTotal: string;
  /** API tải ảnh sản phẩm (mọi người xem được dự án); null = sản phẩm chưa có ảnh */
  thumbnailUrl: string | null;
  /** API tải model .glb (mọi người xem được dự án); null = sản phẩm chưa có model */
  model3dUrl: string | null;

  /** `selection` phải được tải kèm `product.supplier`. */
  static from(
    elementId: string,
    selection: ProductSelection,
  ): ElementSelectionResponseDto {
    const product = selection.product;
    const supplier = product?.supplier;
    if (!product || !supplier) {
      throw new Error('ProductSelection must be loaded with product.supplier');
    }
    return Object.assign(new ElementSelectionResponseDto(), {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      blockCode: product.blockCode,
      supplier: { id: supplier.userId, companyName: supplier.companyName },
      quantity: selection.quantity,
      unitPriceSnapshot: selection.unitPriceSnapshot,
      lineTotal: ProductSelection.lineTotal(selection),
      thumbnailUrl: thumbnailUrl(elementId, product),
      model3dUrl: modelUrl(elementId, product),
    });
  }
}

export class DesignElementResponseDto {
  id: string;
  /** Mã AutoCAD của block, không đổi qua các version; null = file không có handle */
  dxfHandle: string | null;
  blockName: string;
  name: string;
  elementType: DesignElementType;
  /** null = chưa gán được danh mục */
  category: CategoryRefDto | null;
  /** Model minh họa của danh mục, dùng khi món chưa chọn sản phẩm thật */
  defaultModelUrl: string | null;
  /** Tâm món trên mặt bằng (mét), góc xoay (độ) */
  position: ElementPosition | null;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  overrides: Record<string, unknown> | null;
  /** Bản RENDER_3D: CHOSEN = đã chọn sản phẩm thật; bản mặt bằng: null */
  choice: 'CHOSEN' | 'NOT_CHOSEN' | null;
  selection: ElementSelectionResponseDto | null;

  /** `products`: bản RENDER_3D (có trạng thái chọn mẫu). */
  static from(
    element: DesignElement,
    products: boolean,
  ): DesignElementResponseDto {
    const category = element.category ?? null;
    const selection = element.selection ?? null;
    return Object.assign(new DesignElementResponseDto(), {
      id: element.id,
      dxfHandle: element.dxfHandle,
      blockName: element.blockName,
      name: element.name,
      elementType: element.elementType,
      category: category
        ? { id: category.id, code: category.code, name: category.name }
        : null,
      defaultModelUrl: category?.defaultModelUrl ?? null,
      position: element.position,
      widthMm: element.widthMm,
      depthMm: element.depthMm,
      heightMm: element.heightMm,
      overrides: element.overrides,
      choice: products ? (selection ? 'CHOSEN' : 'NOT_CHOSEN') : null,
      selection: selection
        ? ElementSelectionResponseDto.from(element.id, selection)
        : null,
    });
  }
}

export class DesignVersionDetailResponseDto extends DesignVersionResponseDto {
  /** Tường, cửa, phòng tự nhận, unitScale, wallHeight, cảnh báo khi đọc DXF */
  sceneJson: Record<string, unknown> | null;
  elements: DesignElementResponseDto[];
  /** Đường dẫn API tải DXF (`/design-versions/:id/file`, cần Bearer token) */
  fileUrl: string;
  /** Bản RENDER_3D: tổng tạm tính các món đã chọn (VND); bản mặt bằng: null */
  provisionalTotal: string | null;
  /** Bản RENDER_3D: số món có danh mục chưa chọn mẫu; bản mặt bằng: null */
  unchosenCount: number | null;

  static fromDetail(detail: VersionDetail): DesignVersionDetailResponseDto {
    const products = detail.version.versionType === 'RENDER_3D';
    return Object.assign(
      new DesignVersionDetailResponseDto(),
      DesignVersionResponseDto.from(detail.version, detail.label),
      {
        sceneJson: detail.version.sceneJson,
        elements: detail.elements.map((e) =>
          DesignElementResponseDto.from(e, products),
        ),
        fileUrl: `/design-versions/${detail.version.id}/file`,
        provisionalTotal: detail.provisionalTotal,
        unchosenCount: detail.unchosenCount,
      },
    );
  }
}

export class ProductOptionResponseDto {
  id: string;
  name: string;
  sku: string;
  blockCode: string;
  brand: string | null;
  supplier: SupplierRefDto;
  /** VND, giá hiện tại */
  price: string;
  widthMm: number | null;
  depthMm: number | null;
  heightMm: number | null;
  /** API tải ảnh sản phẩm theo quyền dự án; null = chưa có ảnh */
  thumbnailUrl: string | null;
  /** API tải model .glb theo quyền dự án; null = chưa có model */
  model3dUrl: string | null;
  /** So với chỗ của món: FITS / TOO_LONG / TOO_DEEP / TOO_TALL / UNKNOWN */
  fit: ProductFit;
  /** Đang là mẫu được chọn cho món */
  current: boolean;

  static from(
    elementId: string,
    option: ProductOption,
  ): ProductOptionResponseDto {
    const { product } = option;
    const supplier = product.supplier;
    if (!supplier) throw new Error('Product must be loaded with supplier');
    return Object.assign(new ProductOptionResponseDto(), {
      id: product.id,
      name: product.name,
      sku: product.sku,
      blockCode: product.blockCode,
      brand: product.brand,
      supplier: { id: supplier.userId, companyName: supplier.companyName },
      price: product.price,
      widthMm: product.widthMm,
      depthMm: product.depthMm,
      heightMm: product.heightMm,
      thumbnailUrl: thumbnailUrl(elementId, product),
      model3dUrl: modelUrl(elementId, product),
      fit: option.fit,
      current: option.current,
    });
  }
}

export class ProductOptionPageResponseDto {
  elementId: string;
  /** Rẻ trước */
  items: ProductOptionResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(options: ProductOptions): ProductOptionPageResponseDto {
    return Object.assign(new ProductOptionPageResponseDto(), {
      elementId: options.elementId,
      items: options.items.map((o) =>
        ProductOptionResponseDto.from(options.elementId, o),
      ),
      page: options.page,
      limit: options.limit,
      total: options.total,
    });
  }
}

export class ComparedElementDto {
  id: string;
  dxfHandle: string | null;
  blockName: string;
  name: string;
  position: ElementPosition | null;
  overrides: Record<string, unknown> | null;
  /** Sản phẩm đang chọn (RENDER_3D) */
  productId: string | null;
}

export class ElementMoveDto {
  from: ComparedElementDto;
  to: ComparedElementDto;
  /** Mét */
  dx: number;
  dy: number;
  distance: number;
  /** Độ, (-180, 180] */
  rotationDeg: number;
}

export class ElementChangeDto {
  from: ComparedElementDto;
  to: ComparedElementDto;
}

export class VersionRefDto {
  id: string;
  label: string;
  versionNo: number;
}

export class VersionComparisonResponseDto {
  versionType: DesignVersionType;
  from: VersionRefDto;
  to: VersionRefDto;
  added: ComparedElementDto[];
  removed: ComparedElementDto[];
  /** Đổi vị trí (> 1 mm) hoặc góc xoay (> 0.5°) */
  moved: ElementMoveDto[];
  /** Đổi block trong DXF hoặc đổi sản phẩm đã chọn */
  replaced: ElementChangeDto[];
  overridesChanged: ElementChangeDto[];
  /** Món không có handle, không ghép được */
  unmatched: ComparedElementDto[];
  wallsChanged: boolean;
  openingsChanged: boolean;
  /** RENDER_3D: tổng tạm tính 2 bản và chênh lệch (to − from); mặt bằng: null */
  totals: { from: string; to: string; delta: string } | null;

  static from(c: VersionComparison): VersionComparisonResponseDto {
    const ref = (v: { version: DesignVersion; label: string }) => ({
      id: v.version.id,
      label: v.label,
      versionNo: v.version.versionNo,
    });
    const change = (x: { from: ComparedElement; to: ComparedElement }) => ({
      from: comparedRef(x.from),
      to: comparedRef(x.to),
    });
    return Object.assign(new VersionComparisonResponseDto(), {
      versionType: c.from.version.versionType,
      from: ref(c.from),
      to: ref(c.to),
      added: c.elements.added.map(comparedRef),
      removed: c.elements.removed.map(comparedRef),
      moved: c.elements.moved.map((m) => ({
        ...change(m),
        dx: m.dx,
        dy: m.dy,
        distance: m.distance,
        rotationDeg: m.rotationDeg,
      })),
      replaced: c.elements.replaced.map(change),
      overridesChanged: c.elements.overridesChanged.map(change),
      unmatched: c.elements.unmatched.map(comparedRef),
      wallsChanged: c.wallsChanged,
      openingsChanged: c.openingsChanged,
      totals: c.totals,
    });
  }
}

export class ElementRefDto {
  id: string;
  dxfHandle: string | null;
  blockName: string;
  name: string;
}

export class CommentAuthorDto {
  id: string;
  fullName: string;
  role: string;
}

export class CommentReplyDto {
  id: string;
  designVersionId: string;
  content: string;
  author: CommentAuthorDto;
  createdAt: Date;

  /** `comment` phải được tải kèm `author.role`. */
  static from(comment: Comment): CommentReplyDto {
    const author = comment.author;
    if (!author?.role)
      throw new Error('Comment must be loaded with author.role');
    return Object.assign(new CommentReplyDto(), {
      id: comment.id,
      designVersionId: comment.designVersionId,
      content: comment.content,
      author: {
        id: author.id,
        fullName: author.fullName,
        role: author.role.code,
      },
      createdAt: comment.createdAt,
    });
  }
}

export class CommentResponseDto extends CommentReplyDto {
  /** Nhãn version comment được viết (v1, v1.1…) */
  versionLabel: string;
  /** ELEMENT = theo món, POINT = chỗ trống, GENERAL = chung (suy ra từ dữ liệu) */
  kind: CommentKind;
  /** Chỉ comment gốc có trạng thái; câu trả lời là null */
  status: CommentStatus | null;
  /** Điểm ghim (mét) */
  pinPosition: PinPosition | null;
  /** Món lúc viết comment */
  element: ElementRefDto | null;
  /** Món đó ở version đang xem (tìm theo dxfHandle); null = không theo món hoặc món đã bị xóa (dùng pinPosition) */
  currentElement: ElementRefDto | null;
  addressedInVersionId: string | null;
  replies: CommentReplyDto[];

  static fromThread(
    thread: CommentThread,
    labels: Map<string, string>,
  ): CommentResponseDto {
    const { comment } = thread;
    return Object.assign(
      new CommentResponseDto(),
      CommentReplyDto.from(comment),
      {
        versionLabel: labels.get(comment.designVersionId) ?? '',
        kind: comment.kind,
        status: comment.isRoot() ? comment.status : null,
        pinPosition: comment.pinPosition,
        element: elementRef(comment.designElement ?? null),
        currentElement: elementRef(thread.currentElement),
        addressedInVersionId: comment.addressedInVersionId,
        replies: thread.replies.map((r) => CommentReplyDto.from(r)),
      },
    );
  }
}

export class CommentListResponseDto {
  /** Comment gốc của version + comment chưa RESOLVED của các bản trước, cũ trước */
  items: CommentResponseDto[];

  static from(list: VersionComments): CommentListResponseDto {
    return Object.assign(new CommentListResponseDto(), {
      items: list.threads.map((t) =>
        CommentResponseDto.fromThread(t, list.labels),
      ),
    });
  }
}

export class RevisionRequestResponseDto {
  id: string;
  designVersionId: string;
  requestedById: string;
  content: string;
  status: RevisionRequestStatus;
  resolvedInVersionId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;

  static from(request: RevisionRequest): RevisionRequestResponseDto {
    return Object.assign(new RevisionRequestResponseDto(), {
      id: request.id,
      designVersionId: request.designVersionId,
      requestedById: request.requestedById,
      content: request.content,
      status: request.status,
      resolvedInVersionId: request.resolvedInVersionId,
      createdAt: request.createdAt,
      resolvedAt: request.resolvedAt,
    });
  }
}

function elementRef(element: DesignElement | null): ElementRefDto | null {
  return element
    ? {
        id: element.id,
        dxfHandle: element.dxfHandle,
        blockName: element.blockName,
        name: element.name,
      }
    : null;
}

/** API tải model 3D của sản phẩm cho món, quyền theo dự án (không theo role của products). */
function modelUrl(elementId: string, product: Product): string | null {
  return product.model3dKey
    ? `/design-elements/${elementId}/model-3d?productId=${product.id}`
    : null;
}

/** API tải ảnh sản phẩm cho món, quyền theo dự án (route `/products/:id/thumbnail` không cho Customer). */
function thumbnailUrl(elementId: string, product: Product): string | null {
  return product.thumbnailKey
    ? `/design-elements/${elementId}/thumbnail?productId=${product.id}`
    : null;
}

function comparedRef(e: ComparedElement): ComparedElementDto {
  return {
    id: e.id,
    dxfHandle: e.dxfHandle,
    blockName: e.blockName,
    name: e.name,
    position: e.position,
    overrides: e.overrides,
    productId: e.productId,
  };
}
