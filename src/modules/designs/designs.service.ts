import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RequestValidationError,
} from '../../common/errors/index.js';
import {
  CAD_FILES,
  type CadBlock,
  type CadFiles,
  type CadLayerKind,
} from '../../common/ports/cad-files.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import {
  FILE_STORAGE,
  type FileStorage,
} from '../../common/ports/file-storage.js';
import type { UploadedFileData } from '../../common/upload/single-file-upload.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { ProductsService } from '../products/products.service.js';
import type { Project } from '../projects/entities/project.entity.js';
import { ProjectsService } from '../projects/projects.service.js';
import {
  DesignVersionsRepository,
  type NewVersionElement,
} from './design-versions.repository.js';
import {
  DesignElement,
  type DesignElementType,
} from './entities/design-element.entity.js';
import {
  DesignVersion,
  type DesignVersionType,
  MAX_MAJOR_REVISIONS_PER_STAGE,
  type RevisionType,
} from './entities/design-version.entity.js';
import { ProductSelection } from './entities/product-selection.entity.js';
import { RevisionRequest } from './entities/revision-request.entity.js';
import { RevisionRequestsRepository } from './revision-requests.repository.js';

export const MAX_DXF_BYTES = 20 * 1024 * 1024;
const DXF_CONTENT_TYPE = 'application/dxf';
const DEFAULT_WALL_HEIGHT = 2.7;
const LAYOUT: DesignVersionType = 'LAYOUT_2D';
const DXF_HANDLE_MAX_LENGTH = 16;

/** Layer của block → `design_elements.element_type` (DB_CONTEXT §4.5). */
const ELEMENT_TYPE_BY_LAYER: Readonly<Record<CadLayerKind, DesignElementType>> =
  {
    FURNITURE: 'FURNITURE',
    LIGHTING: 'LIGHTING',
    WALL_ITEM: 'DECOR',
  };

/** Dùng cả ở interceptor upload (multer chặn file quá 20 MB). */
export function invalidDxfFile(): RequestValidationError {
  return new RequestValidationError([
    {
      field: 'file',
      errors: ['file phải là bản vẽ DXF dạng text (AutoCAD), tối đa 20 MB'],
    },
  ]);
}

export interface UploadLayoutInput {
  title: string;
  description: string | null;
  revisionType: RevisionType | null;
  wallHeight?: number;
}

export interface RevisionLimit {
  limit: number;
  used: number;
  remaining: number;
}

export interface StageVersions {
  versions: DesignVersion[];
  labels: Map<string, string>;
  revisionLimit: RevisionLimit;
}

export interface VersionDetail {
  version: DesignVersion;
  label: string;
  /** Kèm danh mục và sản phẩm đã chọn. */
  elements: DesignElement[];
  /** RENDER_3D: tổng tạm tính các món đã chọn (VND); bản khác `null`. */
  provisionalTotal: string | null;
  /** RENDER_3D: số món có danh mục chưa chọn mẫu; bản khác `null`. */
  unchosenCount: number | null;
}

export interface DesignFile {
  data: Buffer;
  contentType: string;
  fileName: string;
}

/**
 * Thiết kế & phiên bản (DB_CONTEXT §4.5, §6 quy tắc 5, 6, 7, 14): xem version, Core 3 – Designer upload DXF mặt bằng
 * → version + món + file, khách yêu cầu sửa. Comment ở `DesignCommentsService`; duyệt giai đoạn, chọn sản phẩm (Core 4),
 * Compare ở `DesignProductsService` (tách vì service này đã ~600 dòng).
 * Quyền xem theo dự án qua `ProjectsService.getAccessibleProject` (người ngoài dự án → 404).
 * Chưa làm: version CONCEPT, xuất DXF.
 */
@Injectable()
export class DesignsService {
  private readonly logger = new Logger(DesignsService.name);

  constructor(
    private readonly versions: DesignVersionsRepository,
    private readonly revisions: RevisionRequestsRepository,
    private readonly projects: ProjectsService,
    private readonly catalog: CatalogService,
    private readonly products: ProductsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CAD_FILES) private readonly cad: CadFiles,
  ) {}

  // ---------- Version ----------

  /** Version của một giai đoạn (mặc định mặt bằng 2D), kèm nhãn (v1, v1.1, v2) và số lượt Major còn lại. */
  async listVersions(
    projectId: string,
    actor: AuthUser,
    versionType: DesignVersionType = LAYOUT,
  ): Promise<StageVersions> {
    const project = await this.projects.getAccessibleProject(projectId, actor);
    const versions = await this.versions.findByStage(project.id, versionType);
    return {
      versions,
      labels: DesignVersion.labelsOf(versions),
      revisionLimit: this.revisionLimitOf(versions),
    };
  }

  /** @throws NotFoundError `DESIGN_VERSION_NOT_FOUND` | `PROJECT_NOT_FOUND` */
  async getVersion(id: string, actor: AuthUser): Promise<VersionDetail> {
    const version = await this.getVersionOrThrow(id);
    await this.projects.getAccessibleProject(version.projectId, actor);
    const stage = await this.versions.findByStage(
      version.projectId,
      version.versionType,
    );
    const elements = await this.versions.findElements(version.id);
    const products = version.versionType === 'RENDER_3D';
    return {
      version,
      label: DesignVersion.labelsOf(stage).get(version.id) ?? '',
      elements,
      provisionalTotal: products
        ? ProductSelection.totalOf(elements.map((e) => e.selection ?? null))
        : null,
      unchosenCount: products
        ? elements.filter((e) => e.categoryId && !e.selection).length
        : null,
    };
  }

  /**
   * Designer của dự án upload DXF mặt bằng → version `LAYOUT_2D` (`UPLOAD`, SUBMITTED) + món + file `DRAWING_2D`,
   * bản trước → SUPERSEDED, yêu cầu sửa đang mở của bản trước → RESOLVED (một transaction).
   * File lưu lên storage trước transaction; ghi DB lỗi thì xóa file vừa lưu.
   * @throws ForbiddenError `NOT_PROJECT_DESIGNER`
   * @throws RequestValidationError file không phải DXF
   * @throws BusinessRuleError `PROJECT_NOT_IN_DESIGN` | `STAGE_ALREADY_APPROVED` | `REVISION_TYPE_REQUIRED`
   *   | `REVISION_TYPE_NOT_ALLOWED` | `REVISION_LIMIT_REACHED`
   * @throws ConflictError `DESIGN_VERSION_CONFLICT`
   */
  async uploadLayout(
    projectId: string,
    actor: AuthUser,
    input: UploadLayoutInput,
    file: UploadedFileData,
  ): Promise<VersionDetail> {
    const project = await this.projects.getAccessibleProject(projectId, actor);
    this.assertProjectDesigner(project, actor);
    // TODO(concept): quy tắc 5 yêu cầu đã có concept APPROVED trước khi tạo LAYOUT_2D; chưa làm giai đoạn concept nên chưa kiểm.
    // TODO(products-upload): upload DXF sửa ở giai đoạn Products (RENDER_3D, giữ mẫu đã chọn theo dxf_handle) chưa làm.
    if (project.status !== 'IN_DESIGN') {
      throw new BusinessRuleError(
        'PROJECT_NOT_IN_DESIGN',
        'Dự án chưa ở giai đoạn thiết kế',
        { status: project.status },
      );
    }
    const drawing = this.cad.readDxf(file.buffer, {
      wallHeight: input.wallHeight ?? DEFAULT_WALL_HEIGHT,
    });
    if (!drawing) throw invalidDxfFile();
    // kiểm tra sớm để không lưu file vô ích; kiểm lại trong transaction (đã khóa các version của giai đoạn)
    this.assertCanAddRevision(
      await this.versions.findByStage(project.id, LAYOUT),
      input.revisionType,
    );
    const categories = await this.resolveCategories(drawing.blocks);

    const key = `projects/${project.id}/design-versions/${randomUUID()}.dxf`;
    await this.storage.save(key, file.buffer, DXF_CONTENT_TYPE);
    let id: string;
    try {
      id = await this.uow.run(async () => {
        const stage = await this.versions.findByStageForUpdate(
          project.id,
          LAYOUT,
        );
        this.assertCanAddRevision(stage, input.revisionType);
        const parent = stage.at(-1) ?? null;
        const previous = DesignElement.indexByHandle(
          parent ? await this.versions.findElements(parent.id) : [],
        );
        const now = this.clock.now();
        if (parent) {
          parent.supersede();
          await this.versions.saveStatuses([parent]);
        }
        const version = Object.assign(new DesignVersion(), {
          projectId: project.id,
          // TODO(payments): gắn đợt thanh toán LAYOUT_2D khi có payment_milestones
          milestoneId: null,
          parentVersionId: parent?.id ?? null,
          versionType: LAYOUT,
          versionNo: (parent?.versionNo ?? 0) + 1,
          revisionType: input.revisionType,
          sourceType: 'UPLOAD',
          sceneJson: {
            ...drawing.scene,
            warnings: [...drawing.scene.warnings, ...categories.warnings],
          } as unknown as Record<string, unknown>,
          title: input.title,
          description: input.description,
          status: 'SUBMITTED',
          sourceGenerationId: null,
          createdById: actor.id,
          submittedAt: now,
          approvedAt: null,
        } satisfies Partial<DesignVersion>);
        const saved = await this.versions.createWithContent(
          version,
          this.toElements(drawing.blocks, categories.byBlockName, previous),
          {
            projectId: project.id,
            assetType: 'DRAWING_2D',
            fileKey: key,
            fileName: file.originalname.slice(0, 255) || 'layout.dxf',
            mimeType: DXF_CONTENT_TYPE,
            sizeBytes: String(file.size),
            uploadedById: actor.id,
          },
        );
        if (!saved) {
          throw new ConflictError(
            'DESIGN_VERSION_CONFLICT',
            'Có version khác vừa được tạo cùng lúc, vui lòng thử lại',
          );
        }
        if (parent) {
          await this.resolvePendingRevisions(parent.id, saved.id, now);
        }
        return saved.id;
      });
    } catch (error) {
      await this.deleteFileQuietly(key);
      throw error;
    }
    return this.getVersion(id, actor);
  }

  /** @throws NotFoundError `DESIGN_VERSION_NOT_FOUND` | `PROJECT_NOT_FOUND` | `DESIGN_FILE_NOT_FOUND` */
  async downloadFile(id: string, actor: AuthUser): Promise<DesignFile> {
    const { version, label } = await this.getVersion(id, actor);
    const asset = await this.versions.findDrawing(version.id);
    const data = asset ? await this.storage.read(asset.fileKey) : null;
    if (!data) {
      throw new NotFoundError(
        'DESIGN_FILE_NOT_FOUND',
        'Version chưa có file bản vẽ',
        { designVersionId: id },
      );
    }
    return {
      data,
      contentType: DXF_CONTENT_TYPE,
      fileName: `layout-${label || `n${version.versionNo}`}.dxf`,
    };
  }

  /**
   * Khách yêu cầu sửa bản hiện tại → `revision_requests` OPEN, version → REVISION_REQUESTED.
   * Hết lượt Major vẫn ghi được (Designer còn sửa Minor được); chỉ chặn upload Major.
   * @throws ForbiddenError `NOT_PROJECT_CUSTOMER`
   * @throws BusinessRuleError `STAGE_ALREADY_APPROVED` | `VERSION_NOT_CURRENT`
   */
  async requestRevision(
    versionId: string,
    actor: AuthUser,
    content: string,
  ): Promise<RevisionRequest> {
    const version = await this.getVersionOrThrow(versionId);
    const project = await this.projects.getAccessibleProject(
      version.projectId,
      actor,
    );
    this.assertProjectCustomer(project, actor);
    return this.uow.run(async () => {
      const stage = await this.versions.findByStageForUpdate(
        version.projectId,
        version.versionType,
      );
      this.assertStageOpen(stage);
      const current = this.currentOf(stage, versionId);
      current.requestRevision();
      await this.versions.saveStatuses([current]);
      return this.revisions.save(
        Object.assign(new RevisionRequest(), {
          designVersionId: current.id,
          requestedById: actor.id,
          content,
          status: 'OPEN',
          resolvedInVersionId: null,
          resolvedAt: null,
        } satisfies Partial<RevisionRequest>),
      );
    });
  }

  // ---------- Dùng chung với DesignCommentsService, DesignProductsService ----------

  /**
   * Version mà actor xem được (theo quyền xem dự án), kèm dự án.
   * @throws NotFoundError `DESIGN_VERSION_NOT_FOUND` | `PROJECT_NOT_FOUND`
   */
  async getAccessibleVersion(
    id: string,
    actor: AuthUser,
  ): Promise<{ version: DesignVersion; project: Project }> {
    const version = await this.getVersionOrThrow(id);
    const project = await this.projects.getAccessibleProject(
      version.projectId,
      actor,
    );
    return { version, project };
  }

  /** Nhãn (v1, v1.1…) của mọi version cùng dự án và giai đoạn với `version`. */
  async labelsOfStage(version: DesignVersion): Promise<Map<string, string>> {
    return DesignVersion.labelsOf(
      await this.versions.findByStage(version.projectId, version.versionType),
    );
  }

  /**
   * `version` là bản mới nhất của giai đoạn, còn chờ khách xem (`allowApproved`: cho cả bản đã duyệt).
   * @throws BusinessRuleError `VERSION_NOT_CURRENT`
   */
  async assertCurrentVersion(
    version: DesignVersion,
    allowApproved = false,
  ): Promise<void> {
    const stage = await this.versions.findByStage(
      version.projectId,
      version.versionType,
    );
    this.currentOf(stage, version.id, allowApproved);
  }

  /** @throws BusinessRuleError `STAGE_ALREADY_APPROVED` */
  assertStageOpen(stage: readonly DesignVersion[]): void {
    const approved = stage.find((v) => v.status === 'APPROVED');
    if (approved) {
      throw new BusinessRuleError(
        'STAGE_ALREADY_APPROVED',
        'Giai đoạn đã được duyệt, không thay đổi được nữa',
        { approvedVersionId: approved.id },
      );
    }
  }

  /**
   * Quy tắc 6, 7: bản đầu không có `revisionType`; từ bản thứ hai bắt buộc; số bản MAJOR ≤ giới hạn (tính riêng từng giai đoạn).
   * @throws BusinessRuleError `STAGE_ALREADY_APPROVED` | `REVISION_TYPE_NOT_ALLOWED` | `REVISION_TYPE_REQUIRED`
   *   | `REVISION_LIMIT_REACHED`
   */
  assertCanAddRevision(
    stage: readonly DesignVersion[],
    revisionType: RevisionType | null,
  ): void {
    this.assertStageOpen(stage);
    if (stage.length === 0 && revisionType !== null) {
      throw new BusinessRuleError(
        'REVISION_TYPE_NOT_ALLOWED',
        'Bản đầu tiên của giai đoạn không chọn MINOR / MAJOR',
        { revisionType },
      );
    }
    if (stage.length > 0 && revisionType === null) {
      throw new BusinessRuleError(
        'REVISION_TYPE_REQUIRED',
        'Bản sửa phải chọn MINOR hoặc MAJOR',
      );
    }
    const limit = this.revisionLimitOf(stage);
    if (revisionType === 'MAJOR' && limit.remaining === 0) {
      throw new BusinessRuleError(
        'REVISION_LIMIT_REACHED',
        'Đã dùng hết lượt sửa Major của giai đoạn; chỉ còn sửa Minor hoặc khách duyệt',
        { used: limit.used, limit: limit.limit },
      );
    }
  }

  /**
   * Bản mới nhất của giai đoạn, còn chờ khách xem (`allowApproved`: cho cả bản đã duyệt, dùng khi viết comment).
   * @throws BusinessRuleError `VERSION_NOT_CURRENT`
   */
  currentOf(
    stage: readonly DesignVersion[],
    versionId: string,
    allowApproved = false,
  ): DesignVersion {
    const latest = stage.at(-1);
    const current =
      latest?.id === versionId &&
      (latest.isAwaitingReview() ||
        (allowApproved && latest.status === 'APPROVED'))
        ? latest
        : null;
    if (!current) {
      throw new BusinessRuleError(
        'VERSION_NOT_CURRENT',
        'Chỉ thao tác được trên version hiện tại của giai đoạn',
        { designVersionId: versionId, currentVersionId: latest?.id ?? null },
      );
    }
    return current;
  }

  /** Yêu cầu sửa đang mở của bản cha → RESOLVED khi có bản sửa `versionId` (gọi trong transaction). */
  async resolvePendingRevisions(
    parentId: string,
    versionId: string,
    at: Date,
  ): Promise<void> {
    const pending = await this.revisions.findPendingByVersion(parentId);
    for (const request of pending) request.resolve(versionId, at);
    await this.revisions.saveAll(pending);
  }

  /** @throws ForbiddenError `NOT_PROJECT_DESIGNER` */
  assertProjectDesigner(project: Project, actor: AuthUser): void {
    if (actor.role !== 'DESIGNER' || project.designerId !== actor.id) {
      throw new ForbiddenError(
        'NOT_PROJECT_DESIGNER',
        'Chỉ Designer được giao dự án mới thực hiện được thao tác này',
        { projectId: project.id },
      );
    }
  }

  /** @throws ForbiddenError `NOT_PROJECT_CUSTOMER` */
  assertProjectCustomer(project: Project, actor: AuthUser): void {
    if (actor.role !== 'CUSTOMER' || project.customerId !== actor.id) {
      throw new ForbiddenError(
        'NOT_PROJECT_CUSTOMER',
        'Chỉ khách hàng của dự án mới thực hiện được thao tác này',
        { projectId: project.id },
      );
    }
  }

  // ---------- Private ----------

  private async getVersionOrThrow(id: string): Promise<DesignVersion> {
    const version = await this.versions.findById(id);
    if (!version) throw this.versionNotFound(id);
    return version;
  }

  private versionNotFound(id: string): NotFoundError {
    return new NotFoundError(
      'DESIGN_VERSION_NOT_FOUND',
      'Không tìm thấy version thiết kế',
      { designVersionId: id },
    );
  }

  private revisionLimitOf(stage: readonly DesignVersion[]): RevisionLimit {
    const limit = MAX_MAJOR_REVISIONS_PER_STAGE;
    const used = DesignVersion.countMajor(stage);
    return { limit, used, remaining: Math.max(0, limit - used) };
  }

  /**
   * Danh mục của món theo tên block: trùng `products.block_code` → danh mục của sản phẩm; không thì
   * `product_categories.code` trùng tên (gạch ngang → gạch dưới); không thì bỏ đuôi `-xxx` (`BED-01` → `BED`).
   * Không thấy → `null` + cảnh báo.
   */
  private async resolveCategories(blocks: readonly CadBlock[]): Promise<{
    byBlockName: Map<string, string | null>;
    warnings: string[];
  }> {
    const names = [...new Set(blocks.map((b) => b.blockName))];
    const byProduct = await this.products.findCategoryIdsByBlockCodes(names);
    const candidates = (name: string) => {
      const prefix = name.includes('-')
        ? name.slice(0, name.lastIndexOf('-'))
        : null;
      return [name, prefix]
        .filter((c): c is string => !!c)
        .map((c) => c.toUpperCase().replace(/[\s-]+/g, '_'));
    };
    const byCode = await this.catalog.findActiveCategoryIdsByCodes([
      ...new Set(names.flatMap(candidates)),
    ]);
    const byBlockName = new Map<string, string | null>();
    const warnings: string[] = [];
    for (const name of names) {
      const id =
        byProduct.get(name) ??
        candidates(name)
          .map((c) => byCode.get(c))
          .find((c) => c !== undefined) ??
        null;
      byBlockName.set(name, id);
      if (id === null) {
        warnings.push(`Block ${name} chưa gán được danh mục sản phẩm.`);
      }
    }
    return { byBlockName, warnings };
  }

  /** Block DXF → món; `overrides` chép từ món cùng `dxf_handle` ở bản cha (quy tắc 6). */
  private toElements(
    blocks: readonly CadBlock[],
    categoryOf: Map<string, string | null>,
    previous: Map<string, DesignElement>,
  ): NewVersionElement[] {
    const seen = new Set<string>();
    return blocks.map((b) => {
      // handle trùng / quá dài không nhận lại được → bỏ handle (UQ theo version)
      const handle =
        b.handle &&
        b.handle.length <= DXF_HANDLE_MAX_LENGTH &&
        !seen.has(b.handle)
          ? b.handle
          : null;
      if (handle) seen.add(handle);
      const positive = (mm: number) => (mm > 0 ? mm : null);
      return {
        roomId: null,
        categoryId: categoryOf.get(b.blockName) ?? null,
        name: b.blockName.slice(0, 150),
        elementType: ELEMENT_TYPE_BY_LAYER[b.layerKind],
        position: {
          x: Math.round(b.x * 1000) / 1000,
          y: Math.round(b.y * 1000) / 1000,
          rotation_deg: b.rotationDeg,
        },
        widthMm: positive(b.widthMm),
        depthMm: positive(b.depthMm),
        heightMm: null,
        colorCode: null,
        note: null,
        dxfHandle: handle,
        blockName: b.blockName.slice(0, 100),
        overrides: (handle && previous.get(handle)?.overrides) || null,
      };
    });
  }

  private async deleteFileQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Không xóa được file ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
