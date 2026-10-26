import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from 'decimal.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors/index.js';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { CLOCK, type Clock } from '../../common/ports/clock.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { ApartmentsService } from '../apartments/apartments.service.js';
import type { Apartment } from '../apartments/entities/apartment.entity.js';
import { DesignStylesService } from '../design-styles/design-styles.service.js';
import { UsersService } from '../users/users.service.js';
import type {
  Project,
  ProjectPatch,
  ProjectStatus,
} from './entities/project.entity.js';
import { ProjectsRepository } from './projects.repository.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_SUFFIX_LENGTH = 4;
const CODE_MAX_ATTEMPTS = 3;
/** Giờ Việt Nam (UTC+7) để mã dự án theo ngày địa phương. */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DEFAULT_TOLERANCE_PERCENT = '10';
/** Dự án chưa kết thúc; mỗi căn hộ tối đa một dự án ở các trạng thái này. */
const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = [
  'DRAFT',
  'CONTRACT_PENDING',
  'REQUIREMENT_ANALYSIS',
  'IN_DESIGN',
  'PRODUCT_SELECTION',
  'QUOTING',
];
/** UUID không tồn tại, dùng để lọc ra danh sách rỗng cho role không có quyền xem dự án. */
const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000';

/** Tiền và phần trăm là string (NUMERIC), DTO đã kiểm tra định dạng. */
export interface CreateProjectInput {
  apartmentId: string;
  title: string;
  description: string | null;
  householdSize: number | null;
  preferredStyleId: string | null;
  budgetMin: string;
  budgetMax: string;
  /** `null` = mặc định 10. */
  budgetTolerancePercent: string | null;
}

export interface ListProjectsInput extends PageRequest {
  status?: ProjectStatus;
  keyword?: string;
}

export interface ProjectDetail {
  project: Project;
  /** Kèm `owner` và `rooms`. */
  apartment: Apartment;
}

/**
 * Dự án thiết kế (DB_CONTEXT §4.2, §6). Staff tạo dự án trên căn hộ của customer; `customer_id` = chủ căn hộ.
 * Module khác dùng `getAccessibleProject` (quyền xem, §6 quy tắc 2) và `getManagedProject` (quyền quản lý).
 */
@Injectable()
export class ProjectsService {
  private readonly aiGenerationLimitDefault: number;

  constructor(
    private readonly projects: ProjectsRepository,
    private readonly apartments: ApartmentsService,
    private readonly users: UsersService,
    private readonly styles: DesignStylesService,
    @Inject(CLOCK) private readonly clock: Clock,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.aiGenerationLimitDefault = config.get('AI_GENERATION_LIMIT_DEFAULT', {
      infer: true,
    });
  }

  // ---------- Đọc ----------

  /** Mỗi role chỉ thấy dự án của mình: Customer, Staff phụ trách, Designer được giao; Admin thấy tất cả. */
  list(actor: AuthUser, input: ListProjectsInput): Promise<Paginated<Project>> {
    return this.projects.search(
      {
        ...this.scopeOf(actor),
        status: input.status,
        keyword: input.keyword || undefined,
      },
      { page: input.page, limit: input.limit },
    );
  }

  /** @throws NotFoundError `PROJECT_NOT_FOUND` */
  async getDetail(id: string, actor: AuthUser): Promise<ProjectDetail> {
    const project = await this.getAccessibleProject(id, actor);
    const apartment = await this.apartments.getWithRooms(project.apartmentId);
    return { project, apartment };
  }

  // ---------- Ghi ----------

  /**
   * @throws NotFoundError `APARTMENT_NOT_FOUND` | `DESIGN_STYLE_NOT_FOUND`
   * @throws BusinessRuleError `USER_NOT_ACTIVE` | `DESIGN_STYLE_INACTIVE` | `INVALID_BUDGET_RANGE`
   * @throws ConflictError `APARTMENT_HAS_ACTIVE_PROJECT` | `PROJECT_CODE_GENERATION_FAILED`
   */
  async create(actor: AuthUser, input: CreateProjectInput): Promise<Project> {
    this.assertBudgetRange(input.budgetMin, input.budgetMax);
    const apartment = await this.apartments.getApartmentOrThrow(
      input.apartmentId,
    );
    await this.assertOwnerActive(apartment.ownerId);
    await this.assertNoOpenProject(apartment.id);
    if (input.preferredStyleId !== null) {
      await this.assertUsableStyle(input.preferredStyleId);
    }

    // Một lệnh INSERT, không bọc transaction: vi phạm UNIQUE trong transaction sẽ làm hỏng cả transaction.
    for (let attempt = 0; attempt < CODE_MAX_ATTEMPTS; attempt++) {
      const created = await this.projects.createIfCodeAvailable({
        code: this.generateCode(),
        customerId: apartment.ownerId,
        apartmentId: apartment.id,
        preferredStyleId: input.preferredStyleId,
        staffId: actor.id,
        title: input.title,
        description: input.description,
        householdSize: input.householdSize,
        budgetMin: input.budgetMin,
        budgetMax: input.budgetMax,
        budgetTolerancePercent:
          input.budgetTolerancePercent ?? DEFAULT_TOLERANCE_PERCENT,
        aiGenerationLimit: this.aiGenerationLimitDefault,
        status: 'DRAFT',
      });
      if (created) return this.getProjectOrThrow(created.id);
    }
    throw new ConflictError(
      'PROJECT_CODE_GENERATION_FAILED',
      'Không sinh được mã dự án duy nhất, vui lòng thử lại',
    );
  }

  /**
   * Chỉ Staff phụ trách / Admin, chỉ khi DRAFT.
   * @throws NotFoundError `PROJECT_NOT_FOUND` | `DESIGN_STYLE_NOT_FOUND`
   * @throws ForbiddenError `NOT_PROJECT_STAFF`
   * @throws BusinessRuleError `PROJECT_NOT_EDITABLE` | `DESIGN_STYLE_INACTIVE` | `INVALID_BUDGET_RANGE`
   */
  async update(
    id: string,
    actor: AuthUser,
    patch: ProjectPatch,
  ): Promise<Project> {
    const project = await this.getManagedProject(id, actor);
    if (project.status !== 'DRAFT') {
      throw new BusinessRuleError(
        'PROJECT_NOT_EDITABLE',
        'Chỉ sửa được dự án đang ở trạng thái DRAFT',
        { status: project.status },
      );
    }
    this.assertBudgetRange(
      patch.budgetMin ?? project.budgetMin,
      patch.budgetMax ?? project.budgetMax,
    );
    if (patch.preferredStyleId) {
      await this.assertUsableStyle(patch.preferredStyleId);
    }
    project.update(patch);
    await this.projects.save(project);
    return this.getProjectOrThrow(id);
  }

  // ---------- Dùng chung với module khác ----------

  /**
   * Quyền xem dự án (DB_CONTEXT §6 quy tắc 2): Admin mọi dự án; Staff `staff_id`; Customer `customer_id`;
   * Designer `designer_id`. Supplier và mọi trường hợp khác → 404 (không lộ dự án tồn tại).
   * @throws NotFoundError `PROJECT_NOT_FOUND`
   */
  async getAccessibleProject(id: string, actor: AuthUser): Promise<Project> {
    const project = await this.getProjectOrThrow(id);
    if (!this.canView(project, actor)) throw this.projectNotFound(id);
    return project;
  }

  /**
   * Quyền quản lý dự án: Admin hoặc Staff phụ trách. Người xem được dự án nhưng không phụ trách → 403.
   * @throws NotFoundError `PROJECT_NOT_FOUND`
   * @throws ForbiddenError `NOT_PROJECT_STAFF`
   */
  async getManagedProject(id: string, actor: AuthUser): Promise<Project> {
    const project = await this.getAccessibleProject(id, actor);
    if (actor.role !== 'ADMIN' && project.staffId !== actor.id) {
      throw new ForbiddenError(
        'NOT_PROJECT_STAFF',
        'Chỉ Staff phụ trách hoặc Admin mới được thao tác trên dự án này',
        { projectId: id },
      );
    }
    return project;
  }

  /**
   * DRAFT → CONTRACT_PENDING khi Staff tạo hợp đồng. Không kiểm tra quyền (module gọi đã kiểm tra);
   * gọi trong transaction của module hợp đồng.
   * @throws NotFoundError `PROJECT_NOT_FOUND`
   * @throws BusinessRuleError `INVALID_PROJECT_STATUS_TRANSITION`
   */
  async markContractPending(id: string): Promise<void> {
    const project = await this.getProjectOrThrow(id);
    project.markContractPending();
    await this.projects.save(project);
  }

  /**
   * Chuyển giai đoạn dự án theo thiết kế được duyệt (module designs gọi trong transaction của nó):
   * duyệt mặt bằng → PRODUCT_SELECTION, duyệt sản phẩm → QUOTING.
   * @throws NotFoundError `PROJECT_NOT_FOUND`
   * @throws BusinessRuleError `INVALID_PROJECT_STATUS_TRANSITION`
   */
  async advanceDesignStage(
    id: string,
    to: 'PRODUCT_SELECTION' | 'QUOTING',
  ): Promise<void> {
    const project = await this.getProjectOrThrow(id);
    if (to === 'PRODUCT_SELECTION') project.startProductSelection();
    else project.startQuoting();
    await this.projects.save(project);
  }

  // ---------- Private ----------

  private async getProjectOrThrow(id: string): Promise<Project> {
    const project = await this.projects.findById(id);
    if (!project) throw this.projectNotFound(id);
    return project;
  }

  private projectNotFound(id: string): NotFoundError {
    return new NotFoundError('PROJECT_NOT_FOUND', 'Không tìm thấy dự án', {
      projectId: id,
    });
  }

  private canView(project: Project, actor: AuthUser): boolean {
    switch (actor.role) {
      case 'ADMIN':
        return true;
      case 'STAFF':
        return project.staffId === actor.id;
      case 'CUSTOMER':
        return project.customerId === actor.id;
      case 'DESIGNER':
        return project.designerId === actor.id;
      default:
        return false;
    }
  }

  /** Điều kiện lọc danh sách theo role; Supplier không có quyền nào → không khớp dự án nào. */
  private scopeOf(actor: AuthUser): {
    customerId?: string;
    staffId?: string;
    designerId?: string;
  } {
    switch (actor.role) {
      case 'ADMIN':
        return {};
      case 'STAFF':
        return { staffId: actor.id };
      case 'CUSTOMER':
        return { customerId: actor.id };
      case 'DESIGNER':
        return { designerId: actor.id };
      default:
        return { customerId: NO_MATCH_ID };
    }
  }

  /** @throws BusinessRuleError `INVALID_BUDGET_RANGE` */
  private assertBudgetRange(budgetMin: string, budgetMax: string): void {
    const min = new Decimal(budgetMin);
    if (min.lte(0) || min.gt(budgetMax)) {
      throw new BusinessRuleError(
        'INVALID_BUDGET_RANGE',
        'Ngân sách tối thiểu phải > 0 và không lớn hơn ngân sách tối đa',
        { budgetMin, budgetMax },
      );
    }
  }

  /** Chủ căn phải còn ACTIVE mới tạo được dự án. @throws BusinessRuleError `USER_NOT_ACTIVE` */
  private async assertOwnerActive(ownerId: string): Promise<void> {
    const owner = await this.users.findById(ownerId);
    if (!owner || owner.status !== 'ACTIVE') {
      throw new BusinessRuleError(
        'USER_NOT_ACTIVE',
        'Chủ căn hộ không còn hoạt động, không thể tạo dự án',
        { status: owner?.status ?? null },
      );
    }
  }

  /** Mỗi căn hộ tối đa một dự án chưa kết thúc. @throws ConflictError `APARTMENT_HAS_ACTIVE_PROJECT` */
  private async assertNoOpenProject(apartmentId: string): Promise<void> {
    const open = await this.projects.findOneByApartmentInStatuses(
      apartmentId,
      OPEN_PROJECT_STATUSES,
    );
    if (open) {
      throw new ConflictError(
        'APARTMENT_HAS_ACTIVE_PROJECT',
        'Căn hộ đang có dự án chưa kết thúc',
        { projectId: open.id, projectCode: open.code, status: open.status },
      );
    }
  }

  /** @throws NotFoundError `DESIGN_STYLE_NOT_FOUND` @throws BusinessRuleError `DESIGN_STYLE_INACTIVE` */
  private async assertUsableStyle(styleId: string): Promise<void> {
    const style = await this.styles.get(styleId);
    if (!style.isActive) {
      throw new BusinessRuleError(
        'DESIGN_STYLE_INACTIVE',
        'Phong cách thiết kế đang bị ẩn',
        { styleId },
      );
    }
  }

  /** `PRJ-YYMMDD-XXXX`, ngày theo giờ Việt Nam. */
  private generateCode(): string {
    const local = new Date(this.clock.now().getTime() + VN_OFFSET_MS);
    const yy = String(local.getUTCFullYear() % 100).padStart(2, '0');
    const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(local.getUTCDate()).padStart(2, '0');
    let suffix = '';
    for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) {
      suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return `PRJ-${yy}${mm}${dd}-${suffix}`;
  }
}
