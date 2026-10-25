import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type {
  PageRequest,
  Paginated,
} from '../../common/pagination/paginated.js';
import { escapeLike } from '../../database/postgres/escape-like.js';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { Project, type ProjectStatus } from './entities/project.entity.js';

export type NewProject = Pick<
  Project,
  | 'code'
  | 'customerId'
  | 'apartmentId'
  | 'preferredStyleId'
  | 'staffId'
  | 'title'
  | 'description'
  | 'householdSize'
  | 'budgetMin'
  | 'budgetMax'
  | 'budgetTolerancePercent'
  | 'aiGenerationLimit'
  | 'status'
>;

export interface ProjectSearchFilter {
  customerId?: string;
  staffId?: string;
  designerId?: string;
  status?: ProjectStatus;
  /** Tìm trong mã hoặc tiêu đề dự án (không phân biệt hoa thường). */
  keyword?: string;
}

/** `projects`. Không có `delete`: dự án kết thúc bằng `CANCELLED`/`COMPLETED`. */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(Project);
  }

  findById(id: string): Promise<Project | null> {
    return this.repo.findOne({
      where: { id },
      relations: {
        apartment: true,
        customer: true,
        staff: true,
        preferredStyle: true,
      },
    });
  }

  /** Một dự án trên căn hộ có trạng thái thuộc `statuses`; không có → `null`. */
  findOneByApartmentInStatuses(
    apartmentId: string,
    statuses: readonly ProjectStatus[],
  ): Promise<Project | null> {
    return this.repo.findOne({
      where: { apartmentId, status: In([...statuses]) },
    });
  }

  async search(
    filter: ProjectSearchFilter,
    page: PageRequest,
  ): Promise<Paginated<Project>> {
    const qb = this.repo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.apartment', 'a')
      .innerJoinAndSelect('p.customer', 'c')
      .innerJoinAndSelect('p.staff', 's')
      .leftJoinAndSelect('p.preferredStyle', 'st');
    if (filter.customerId !== undefined) {
      qb.andWhere('p.customerId = :customerId', {
        customerId: filter.customerId,
      });
    }
    if (filter.staffId !== undefined) {
      qb.andWhere('p.staffId = :staffId', { staffId: filter.staffId });
    }
    if (filter.designerId !== undefined) {
      qb.andWhere('p.designerId = :designerId', {
        designerId: filter.designerId,
      });
    }
    if (filter.status !== undefined) {
      qb.andWhere('p.status = :status', { status: filter.status });
    }
    if (filter.keyword) {
      qb.andWhere('(p.code ILIKE :keyword OR p.title ILIKE :keyword)', {
        keyword: `%${escapeLike(filter.keyword)}%`,
      });
    }
    const [items, total] = await qb
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((page.page - 1) * page.limit)
      .take(page.limit)
      .getManyAndCount();
    return { items, page: page.page, limit: page.limit, total };
  }

  /** Trùng `code` (`uq_projects_code`) → `null`. */
  async createIfCodeAvailable(project: NewProject): Promise<Project | null> {
    try {
      return await this.repo.save(this.repo.create(project));
    } catch (error) {
      if (isUniqueViolation(error, 'uq_projects_code')) return null;
      throw error;
    }
  }

  save(project: Project): Promise<Project> {
    return this.repo.save(project);
  }
}
