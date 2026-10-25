import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from './dto/projects.dto.js';
import {
  ProjectDetailResponseDto,
  ProjectPageResponseDto,
  ProjectResponseDto,
} from './dto/projects.response.dto.js';
import { ProjectsService } from './projects.service.js';

/** `/projects`. Supplier không có quyền nào (DB_CONTEXT §6 quy tắc 2). */
@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** Danh sách dự án của tôi (Customer/Staff/Designer) hoặc tất cả (Admin); lọc theo trạng thái, từ khóa; có phân trang. */
  @Roles('ADMIN', 'STAFF', 'CUSTOMER', 'DESIGNER')
  @Get()
  async list(
    @Query() query: ListProjectsQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProjectPageResponseDto> {
    const page = await this.projects.list(actor, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      keyword: query.q,
    });
    return ProjectPageResponseDto.from(page);
  }

  /**
   * Staff tạo dự án (DRAFT) trên căn hộ của customer; Staff tạo là Staff phụ trách.
   * Chủ căn không còn ACTIVE → 422 USER_NOT_ACTIVE; căn đang có dự án chưa kết thúc → 409 APARTMENT_HAS_ACTIVE_PROJECT.
   */
  @Roles('STAFF')
  @Post()
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProjectResponseDto> {
    const project = await this.projects.create(actor, {
      apartmentId: dto.apartmentId,
      title: dto.title,
      description: dto.description ?? null,
      householdSize: dto.householdSize ?? null,
      preferredStyleId: dto.preferredStyleId ?? null,
      budgetMin: dto.budgetMin,
      budgetMax: dto.budgetMax,
      budgetTolerancePercent:
        dto.budgetTolerancePercent === undefined
          ? null
          : String(dto.budgetTolerancePercent),
    });
    return ProjectResponseDto.from(project);
  }

  /** Chi tiết dự án kèm căn hộ và danh sách phòng (không thuộc quyền xem → 404). */
  @Roles('ADMIN', 'STAFF', 'CUSTOMER', 'DESIGNER')
  @Get(':id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProjectDetailResponseDto> {
    return ProjectDetailResponseDto.fromDetail(
      await this.projects.getDetail(id, actor),
    );
  }

  /** Staff phụ trách / Admin sửa thông tin dự án, chỉ khi DRAFT (422 PROJECT_NOT_EDITABLE). */
  @Roles('STAFF', 'ADMIN')
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ProjectResponseDto> {
    const project = await this.projects.update(id, actor, {
      title: dto.title,
      description: dto.description,
      householdSize: dto.householdSize,
      preferredStyleId: dto.preferredStyleId,
      budgetMin: dto.budgetMin,
      budgetMax: dto.budgetMax,
      budgetTolerancePercent:
        dto.budgetTolerancePercent === undefined
          ? undefined
          : String(dto.budgetTolerancePercent),
    });
    return ProjectResponseDto.from(project);
  }
}
