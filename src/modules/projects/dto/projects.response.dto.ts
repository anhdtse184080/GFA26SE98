import type { Paginated } from '../../../common/pagination/paginated.js';
import { ApartmentWithRoomsResponseDto } from '../../apartments/dto/apartments.response.dto.js';
import type { Project, ProjectStatus } from '../entities/project.entity.js';
import type { ProjectDetail } from '../projects.service.js';

export class ProjectPersonDto {
  id: string;
  fullName: string;
  email: string;
}

export class ProjectApartmentSummaryDto {
  id: string;
  buildingName: string;
  address: string;
  tower: string | null;
  unitNo: string;
}

export class ProjectStyleRefDto {
  id: string;
  code: string;
  name: string;
}

export class ProjectResponseDto {
  id: string;
  code: string;
  title: string;
  description: string | null;
  householdSize: number | null;
  status: ProjectStatus;
  /** VND, dạng string 2 chữ số thập phân (vd "150000000.00") */
  budgetMin: string;
  budgetMax: string;
  /** Dung sai vượt ngân sách (%), vd "10.00" */
  budgetTolerancePercent: string;
  aiGenerationLimit: number;
  aiGenerationUsed: number;
  /** `user_id` của designer được giao; null = chưa giao */
  designerId: string | null;
  designerAssignedAt: Date | null;
  preferredStyle: ProjectStyleRefDto | null;
  customer: ProjectPersonDto;
  staff: ProjectPersonDto;
  apartment: ProjectApartmentSummaryDto;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;

  /** `project` phải được tải kèm `apartment`, `customer`, `staff`, `preferredStyle`. */
  static from(project: Project): ProjectResponseDto {
    const { apartment, customer, staff } = project;
    if (!apartment || !customer || !staff) {
      throw new Error(
        'Project must be loaded with apartment, customer and staff',
      );
    }
    const style = project.preferredStyle;
    return Object.assign(new ProjectResponseDto(), {
      id: project.id,
      code: project.code,
      title: project.title,
      description: project.description,
      householdSize: project.householdSize,
      status: project.status,
      budgetMin: project.budgetMin,
      budgetMax: project.budgetMax,
      budgetTolerancePercent: project.budgetTolerancePercent,
      aiGenerationLimit: project.aiGenerationLimit,
      aiGenerationUsed: project.aiGenerationUsed,
      designerId: project.designerId,
      designerAssignedAt: project.designerAssignedAt,
      preferredStyle: style
        ? { id: style.id, code: style.code, name: style.name }
        : null,
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        email: customer.email,
      },
      staff: { id: staff.id, fullName: staff.fullName, email: staff.email },
      apartment: {
        id: apartment.id,
        buildingName: apartment.buildingName,
        address: apartment.address,
        tower: apartment.tower,
        unitNo: apartment.unitNo,
      },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      completedAt: project.completedAt,
    });
  }
}

/** Chi tiết dự án: `apartment` đầy đủ kèm danh sách phòng. */
export class ProjectDetailResponseDto extends ProjectResponseDto {
  declare apartment: ApartmentWithRoomsResponseDto;

  static fromDetail(detail: ProjectDetail): ProjectDetailResponseDto {
    return Object.assign(
      new ProjectDetailResponseDto(),
      ProjectResponseDto.from(detail.project),
      { apartment: ApartmentWithRoomsResponseDto.from(detail.apartment) },
    );
  }
}

export class ProjectPageResponseDto {
  items: ProjectResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(page: Paginated<Project>): ProjectPageResponseDto {
    return Object.assign(new ProjectPageResponseDto(), {
      items: page.items.map((p) => ProjectResponseDto.from(p)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
