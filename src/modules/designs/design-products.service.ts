import { Decimal } from 'decimal.js';
import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/index.js';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import type { Product } from '../products/entities/product.entity.js';
import {
  type ProductFile,
  type ProductFileKind,
  ProductsService,
} from '../products/products.service.js';
import type { Project } from '../projects/entities/project.entity.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  DesignVersionsRepository,
  type NewVersionAsset,
  type NewVersionElement,
} from './design-versions.repository.js';
import { DesignsService, type VersionDetail } from './designs.service.js';
import {
  type ComparableElement,
  DesignElement,
  type ElementComparison,
  type ProductFit,
} from './entities/design-element.entity.js';
import {
  DesignVersion,
  type DesignVersionType,
  type RevisionType,
} from './entities/design-version.entity.js';
import {
  type ChoosableProduct,
  type EditableElement,
  ProductSelection,
  type SelectionData,
} from './entities/product-selection.entity.js';

const LAYOUT: DesignVersionType = 'LAYOUT_2D';
const RENDER: DesignVersionType = 'RENDER_3D';

export interface ProductOption {
  product: Product;
  fit: ProductFit;
  /** Đang là mẫu được chọn cho món. */
  current: boolean;
}

export interface ProductOptions extends Paginated<ProductOption> {
  elementId: string;
}

export interface SaveEditInput {
  title: string;
  description: string | null;
  revisionType: RevisionType;
  selections: { elementId: string; productId: string }[];
  overrides: { elementId: string; overrides: Record<string, unknown> }[];
  chooseAllRemaining: boolean;
}

/** Món của một version khi so sánh: dữ liệu so + bản ghi gốc để trả về API. */
export interface ComparedElement extends ComparableElement {
  element: DesignElement;
}

export interface VersionComparison {
  from: { version: DesignVersion; label: string };
  to: { version: DesignVersion; label: string };
  elements: ElementComparison<ComparedElement>;
  wallsChanged: boolean;
  openingsChanged: boolean;
  /** RENDER_3D: tổng tạm tính 2 bản và chênh lệch (to − from); bản khác `null`. */
  totals: { from: string; to: string; delta: string } | null;
}

/**
 * Duyệt giai đoạn (Layout, Products), Core 4 – chọn sản phẩm thật, Compare 2 version (DB_CONTEXT §4.5, §4.6,
 * §6 quy tắc 5, 6, 7, 9). Tách khỏi `DesignsService` vì service đó đã ~600 dòng; dùng lại các kiểm tra chung của nó.
 * - Duyệt mặt bằng → bản RENDER_3D đầu tiên (`EDIT`, chép món) + dự án PRODUCT_SELECTION.
 * - Lưu chỉnh sửa trên web = 1 version RENDER_3D `EDIT` mới: chép món + lựa chọn của bản cha, đổi mẫu trong cùng
 *   danh mục, chỉnh `overrides`, "Choose all remaining". Không thêm / xóa / dời món (việc của AutoCAD).
 * - Duyệt sản phẩm (mọi món có danh mục đã chọn) → dự án QUOTING.
 * - Model 3D của sản phẩm: mọi người xem được dự án đều tải được (quyền theo dự án, không theo role của products).
 */
@Injectable()
export class DesignProductsService {
  constructor(
    private readonly versions: DesignVersionsRepository,
    private readonly designs: DesignsService,
    private readonly projects: ProjectsService,
    private readonly products: ProductsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------- Duyệt giai đoạn ----------

  /**
   * Khách duyệt bản hiện tại hoặc một bản cũ (quy tắc 7) → APPROVED, các bản mới hơn → SUPERSEDED; trong cùng transaction:
   * - LAYOUT_2D: tạo bản RENDER_3D đầu tiên (quy tắc 5), dự án → PRODUCT_SELECTION
   * - RENDER_3D: mọi món có danh mục phải đã chọn mẫu, dự án → QUOTING
   * @throws ForbiddenError `NOT_PROJECT_CUSTOMER`
   * @throws BusinessRuleError `STAGE_ALREADY_APPROVED` | `PRODUCTS_NOT_CHOSEN` | `VERSION_NOT_APPROVABLE`
   *   | `INVALID_PROJECT_STATUS_TRANSITION`
   */
  async approve(versionId: string, actor: AuthUser): Promise<VersionDetail> {
    const { version, project } = await this.designs.getAccessibleVersion(
      versionId,
      actor,
    );
    this.designs.assertProjectCustomer(project, actor);
    if (version.versionType === 'CONCEPT') {
      throw new BusinessRuleError(
        'VERSION_NOT_APPROVABLE',
        'Chưa hỗ trợ duyệt concept',
        { versionType: version.versionType },
      );
    }
    await this.uow.run(async () => {
      const stage = await this.versions.findByStageForUpdate(
        version.projectId,
        version.versionType,
      );
      this.designs.assertStageOpen(stage);
      const target = stage.find((v) => v.id === versionId) ?? version;
      if (target.versionType === RENDER) {
        const elements = await this.versions.findElements(target.id);
        const unchosen = elements.filter(
          (e) => e.categoryId && !e.selection,
        ).length;
        if (unchosen > 0) {
          throw new BusinessRuleError(
            'PRODUCTS_NOT_CHOSEN',
            'Còn món chưa chọn sản phẩm thật',
            { unchosen },
          );
        }
      }
      const now = this.clock.now();
      const newer = stage.filter((v) => v.versionNo > target.versionNo);
      target.approve(now);
      for (const v of newer) v.supersede();
      await this.versions.saveStatuses([target, ...newer]);
      if (target.versionType === LAYOUT) {
        // TODO(payments): ghi approved_version_id, đợt LAYOUT_2D → INVOICED (quy tắc 8).
        await this.createFirstRender(target, project, now);
        await this.projects.advanceDesignStage(project.id, 'PRODUCT_SELECTION');
      } else {
        // TODO(payments): ghi approved_version_id, đợt RENDER_3D → INVOICED (quy tắc 8).
        // TODO(quotation): Core 5 tạo báo giá (quotations) từ bản đã duyệt này.
        await this.projects.advanceDesignStage(project.id, 'QUOTING');
      }
    });
    return this.designs.getVersion(versionId, actor);
  }

  // ---------- Chọn sản phẩm (Core 4) ----------

  /**
   * Sản phẩm chọn được cho món: ACTIVE, supplier đang hợp tác, cùng danh mục (mọi supplier), rẻ trước,
   * kèm kết quả so kích thước. Món chưa có danh mục → danh sách rỗng.
   * @throws NotFoundError `DESIGN_ELEMENT_NOT_FOUND` | `PROJECT_NOT_FOUND`
   */
  async productOptions(
    elementId: string,
    actor: AuthUser,
    page: PageRequest,
  ): Promise<ProductOptions> {
    const element = await this.getAccessibleElement(elementId, actor);
    if (!element.categoryId) {
      return {
        items: [],
        page: page.page,
        limit: page.limit,
        total: 0,
        elementId,
      };
    }
    const result = await this.products.searchChoosableByCategory(
      element.categoryId,
      page,
    );
    const wallHeight = element.designVersion?.sceneJson?.wallHeight;
    const wallHeightMm =
      typeof wallHeight === 'number' ? Math.round(wallHeight * 1000) : null;
    return {
      ...result,
      elementId,
      items: result.items.map((product) => ({
        product,
        fit: DesignElement.fitOf(element, product, wallHeightMm),
        current: element.selection?.productId === product.id,
      })),
    };
  }

  /**
   * Ảnh / model 3D (.glb) của sản phẩm đang chọn cho món (không gửi `productId`) hoặc của một lựa chọn hợp lệ
   * (cùng danh mục, đang bán). Quyền: người xem được dự án (không theo role của products).
   * @throws NotFoundError `DESIGN_ELEMENT_NOT_FOUND` | `PROJECT_NOT_FOUND` | `PRODUCT_NOT_FOUND` | `PRODUCT_FILE_NOT_FOUND`
   */
  async downloadProductFile(
    elementId: string,
    actor: AuthUser,
    kind: ProductFileKind,
    productId?: string,
  ): Promise<ProductFile> {
    const element = await this.getAccessibleElement(elementId, actor);
    const selected = element.selection?.productId ?? null;
    const target = productId ?? selected;
    if (!target) throw this.productNotFound(elementId, null);
    if (target !== selected) {
      const [option] = await this.products.findChoosable({ ids: [target] });
      if (
        !option ||
        !element.categoryId ||
        option.categoryId !== element.categoryId
      ) {
        throw this.productNotFound(elementId, target);
      }
    }
    return this.products.readProductFile(target, kind);
  }

  /**
   * Designer lưu chỉnh sửa trên bản RENDER_3D hiện tại → version RENDER_3D `EDIT` mới (một transaction):
   * bản cha → SUPERSEDED, chép món + lựa chọn, áp đổi mẫu / overrides / "Choose all remaining",
   * yêu cầu sửa đang mở của bản cha → RESOLVED. Minor / Major và giới hạn Major tính riêng cho RENDER_3D.
   * @throws ForbiddenError `NOT_PROJECT_DESIGNER`
   * @throws BusinessRuleError `VERSION_NOT_EDITABLE` | `PROJECT_NOT_IN_PRODUCT_SELECTION` | `VERSION_NOT_CURRENT`
   *   | `STAGE_ALREADY_APPROVED` | `REVISION_LIMIT_REACHED` | `ELEMENT_NOT_IN_VERSION` | `PRODUCT_NOT_AVAILABLE`
   *   | `PRODUCT_CATEGORY_MISMATCH` | `NO_CHANGES`
   */
  async saveEdit(
    versionId: string,
    actor: AuthUser,
    input: SaveEditInput,
  ): Promise<VersionDetail> {
    const { version, project } = await this.designs.getAccessibleVersion(
      versionId,
      actor,
    );
    this.designs.assertProjectDesigner(project, actor);
    if (version.versionType !== RENDER) {
      throw new BusinessRuleError(
        'VERSION_NOT_EDITABLE',
        'Chỉ chỉnh sửa trên web được bản chọn sản phẩm (RENDER_3D); mặt bằng sửa trong AutoCAD rồi upload',
        { versionType: version.versionType },
      );
    }
    if (project.status !== 'PRODUCT_SELECTION') {
      throw new BusinessRuleError(
        'PROJECT_NOT_IN_PRODUCT_SELECTION',
        'Dự án không ở giai đoạn chọn sản phẩm',
        { status: project.status },
      );
    }
    const id = await this.uow.run(async () => {
      const stage = await this.versions.findByStageForUpdate(
        project.id,
        RENDER,
      );
      this.designs.assertCanAddRevision(stage, input.revisionType);
      const parent = this.designs.currentOf(stage, versionId);
      const elements = await this.versions.findElements(parent.id);
      const products = await this.products.findChoosable({
        ids: input.selections.map((s) => s.productId),
        blockCodes: input.chooseAllRemaining
          ? [...new Set(elements.map((e) => e.blockName))]
          : [],
      });
      const choosable = products.map(toChoosable);
      const plan = ProductSelection.planEdit({
        elements: elements.map(toEditable),
        selections: input.selections,
        overrides: input.overrides,
        chooseAllRemaining: input.chooseAllRemaining,
        products: new Map(choosable.map((p) => [p.id, p])),
        productsByBlockCode: new Map(choosable.map((p) => [p.blockCode, p])),
        actorId: actor.id,
      });
      if (plan.changed === 0) {
        throw new BusinessRuleError(
          'NO_CHANGES',
          'Không có thay đổi nào so với bản hiện tại',
          { unchosen: plan.unchosen },
        );
      }
      const now = this.clock.now();
      parent.supersede();
      await this.versions.saveStatuses([parent]);
      const byId = new Map(elements.map((e) => [e.id, e]));
      const saved = await this.createVersion(
        {
          projectId: project.id,
          parentVersionId: parent.id,
          versionNo: (stage.at(-1)?.versionNo ?? 0) + 1,
          revisionType: input.revisionType,
          sceneJson: parent.sceneJson,
          title: input.title,
          description: input.description,
          createdById: actor.id,
          submittedAt: now,
        },
        plan.items.map((item) => ({
          ...copyElement(byId.get(item.source.id) as DesignElement),
          overrides: item.overrides,
          selection: item.selection,
        })),
        await this.drawingCopy(parent.id),
      );
      await this.designs.resolvePendingRevisions(parent.id, saved.id, now);
      return saved.id;
    });
    return this.designs.getVersion(id, actor);
  }

  // ---------- Compare ----------

  /**
   * So 2 version cùng dự án, cùng giai đoạn: món thêm / xóa / dời / đổi mẫu / đổi thuộc tính (ghép theo `dxf_handle`),
   * tường / cửa có đổi không, và chênh lệch tổng tiền (RENDER_3D).
   * @throws NotFoundError `DESIGN_VERSION_NOT_FOUND` | `PROJECT_NOT_FOUND`
   * @throws BusinessRuleError `VERSION_NOT_COMPARABLE`
   */
  async compare(
    versionId: string,
    withId: string,
    actor: AuthUser,
  ): Promise<VersionComparison> {
    const { version: from } = await this.designs.getAccessibleVersion(
      versionId,
      actor,
    );
    const { version: to } = await this.designs.getAccessibleVersion(
      withId,
      actor,
    );
    if (
      from.projectId !== to.projectId ||
      from.versionType !== to.versionType
    ) {
      throw new BusinessRuleError(
        'VERSION_NOT_COMPARABLE',
        'Chỉ so được 2 version cùng dự án và cùng giai đoạn',
        { versionId, with: withId },
      );
    }
    const [a, b] = await Promise.all([
      this.versions.findElements(from.id),
      this.versions.findElements(to.id),
    ]);
    const labels = await this.designs.labelsOfStage(from);
    const totals =
      from.versionType === RENDER
        ? (() => {
            const total = (list: DesignElement[]) =>
              ProductSelection.totalOf(list.map((e) => e.selection ?? null));
            const ta = total(a);
            const tb = total(b);
            return {
              from: ta,
              to: tb,
              delta: new Decimal(tb).minus(ta).toFixed(2),
            };
          })()
        : null;
    return {
      from: { version: from, label: labels.get(from.id) ?? '' },
      to: { version: to, label: labels.get(to.id) ?? '' },
      elements: DesignElement.compare(a.map(toComparable), b.map(toComparable)),
      ...DesignVersion.compareScenes(from.sceneJson, to.sceneJson),
      totals,
    };
  }

  // ---------- Private ----------

  /**
   * Bản RENDER_3D đầu tiên từ mặt bằng vừa duyệt (quy tắc 5): `EDIT`, chép `scene_json` + món (handle, danh mục,
   * overrides…), dùng lại file DXF; món có block trùng `block_code` một sản phẩm đang bán cùng danh mục → chọn sẵn.
   */
  private async createFirstRender(
    layout: DesignVersion,
    project: Project,
    now: Date,
  ): Promise<void> {
    const elements = await this.versions.findElements(layout.id);
    const byBlockCode = new Map(
      (
        await this.products.findChoosable({
          blockCodes: [...new Set(elements.map((e) => e.blockName))],
        })
      ).map((p) => [p.blockCode, toChoosable(p)]),
    );
    const stage = await this.versions.findByStageForUpdate(project.id, RENDER);
    // Hành động hệ thống khi khách duyệt: ghi cho designer của dự án (người làm tiếp Core 4).
    const owner = project.designerId ?? layout.createdById;
    const label = (await this.designs.labelsOfStage(layout)).get(layout.id);
    await this.createVersion(
      {
        projectId: project.id,
        parentVersionId: layout.id,
        versionNo: (stage.at(-1)?.versionNo ?? 0) + 1,
        revisionType: null,
        sceneJson: layout.sceneJson,
        title: `Chọn sản phẩm từ mặt bằng ${label ?? ''}`.trim(),
        description: null,
        createdById: owner,
        submittedAt: now,
      },
      elements.map((e) => {
        const product = byBlockCode.get(e.blockName);
        return {
          ...copyElement(e),
          selection:
            product && e.categoryId && product.categoryId === e.categoryId
              ? ProductSelection.choose(product, owner)
              : null,
        };
      }),
      await this.drawingCopy(layout.id),
    );
  }

  /** Tạo version RENDER_3D `EDIT` (SUBMITTED). @throws ConflictError `DESIGN_VERSION_CONFLICT` */
  private async createVersion(
    fields: Pick<
      DesignVersion,
      | 'projectId'
      | 'parentVersionId'
      | 'versionNo'
      | 'revisionType'
      | 'sceneJson'
      | 'title'
      | 'description'
      | 'createdById'
      | 'submittedAt'
    >,
    elements: NewVersionElement[],
    asset: NewVersionAsset | null,
  ): Promise<DesignVersion> {
    const version = Object.assign(new DesignVersion(), fields, {
      // TODO(payments): gắn đợt thanh toán RENDER_3D khi có payment_milestones
      milestoneId: null,
      versionType: RENDER,
      sourceType: 'EDIT',
      status: 'SUBMITTED',
      sourceGenerationId: null,
      approvedAt: null,
    } satisfies Partial<DesignVersion>);
    const saved = await this.versions.createWithContent(
      version,
      elements,
      asset,
    );
    if (!saved) {
      throw new ConflictError(
        'DESIGN_VERSION_CONFLICT',
        'Có version khác vừa được tạo cùng lúc, vui lòng thử lại',
      );
    }
    return saved;
  }

  /** Bản EDIT dùng lại DXF của bản cha: asset mới trỏ cùng khóa file (không chép file). */
  private async drawingCopy(
    versionId: string,
  ): Promise<NewVersionAsset | null> {
    const drawing = await this.versions.findDrawing(versionId);
    return drawing
      ? {
          projectId: drawing.projectId,
          assetType: drawing.assetType,
          fileKey: drawing.fileKey,
          fileName: drawing.fileName,
          mimeType: drawing.mimeType,
          sizeBytes: drawing.sizeBytes,
          uploadedById: drawing.uploadedById,
        }
      : null;
  }

  /** Món (kèm version và lựa chọn) mà actor xem được. @throws NotFoundError `DESIGN_ELEMENT_NOT_FOUND` */
  private async getAccessibleElement(
    id: string,
    actor: AuthUser,
  ): Promise<DesignElement> {
    const element = await this.versions.findElementWithVersion(id);
    if (!element) {
      throw new NotFoundError(
        'DESIGN_ELEMENT_NOT_FOUND',
        'Không tìm thấy món',
        {
          designElementId: id,
        },
      );
    }
    await this.designs.getAccessibleVersion(element.designVersionId, actor);
    return element;
  }

  private productNotFound(
    elementId: string,
    productId: string | null,
  ): NotFoundError {
    return new NotFoundError(
      'PRODUCT_NOT_FOUND',
      productId
        ? 'Sản phẩm không phải lựa chọn của món này'
        : 'Món chưa chọn sản phẩm',
      { designElementId: elementId, productId },
    );
  }
}

function toChoosable(p: Product): ChoosableProduct {
  return {
    id: p.id,
    categoryId: p.categoryId,
    blockCode: p.blockCode,
    price: p.price,
  };
}

function selectionData(e: DesignElement): SelectionData | null {
  const s = e.selection;
  return s
    ? {
        productId: s.productId,
        quantity: s.quantity,
        unitPriceSnapshot: s.unitPriceSnapshot,
        recommendationId: s.recommendationId,
        selectedById: s.selectedById,
        note: s.note,
      }
    : null;
}

function toEditable(e: DesignElement): EditableElement {
  return {
    id: e.id,
    categoryId: e.categoryId,
    blockName: e.blockName,
    overrides: e.overrides,
    selection: selectionData(e),
  };
}

function toComparable(e: DesignElement): ComparedElement {
  return {
    id: e.id,
    dxfHandle: e.dxfHandle,
    blockName: e.blockName,
    name: e.name,
    position: e.position,
    overrides: e.overrides,
    productId: e.selection?.productId ?? null,
    element: e,
  };
}

/** Chép món sang version mới (giữ handle, danh mục, vị trí, overrides) kèm lựa chọn hiện có. */
function copyElement(e: DesignElement): NewVersionElement {
  return {
    roomId: e.roomId,
    categoryId: e.categoryId,
    name: e.name,
    elementType: e.elementType,
    position: e.position,
    widthMm: e.widthMm,
    depthMm: e.depthMm,
    heightMm: e.heightMm,
    colorCode: e.colorCode,
    note: e.note,
    dxfHandle: e.dxfHandle,
    blockName: e.blockName,
    overrides: e.overrides,
    selection: selectionData(e),
  };
}
