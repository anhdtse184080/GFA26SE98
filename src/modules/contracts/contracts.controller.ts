import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import {
  requiredFile,
  SingleFileUpload,
  type UploadedFileData,
} from '../../common/upload/single-file-upload.js';
import { CreateContractDto, UpdateContractDto } from './dto/contracts.dto.js';
import { ContractResponseDto } from './dto/contracts.response.dto.js';
import {
  ContractsService,
  invalidPdfFile,
  MAX_CONTRACT_PDF_BYTES,
} from './contracts.service.js';

/** Swagger: body multipart một field `file`. */
const FILE_BODY: Parameters<typeof ApiBody>[0] = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary' } },
  },
};

/**
 * Hợp đồng thiết kế: `/projects/:projectId/contract` (1 dự án – tối đa 1 hợp đồng) và `/contracts/:id`.
 * Ghi: Staff phụ trách dự án. Đọc: ai xem được dự án; Customer chỉ sau khi Staff gửi ký.
 */
@ApiTags('contracts')
@Controller()
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  /**
   * Staff phụ trách tạo hợp đồng DRAFT kèm lịch thanh toán; dự án → CONTRACT_PENDING.
   * Dự án đã có hợp đồng → 409 CONTRACT_ALREADY_EXISTS; tổng các đợt ≠ phí thiết kế → 422 MILESTONE_TOTAL_MISMATCH.
   */
  @Roles('STAFF')
  @Post('projects/:projectId/contract')
  async create(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateContractDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ContractResponseDto> {
    const contract = await this.contracts.create(projectId, actor, {
      totalDesignFee: dto.totalDesignFee,
      maxRevisionsPerStage: dto.maxRevisionsPerStage,
      reviewWindowDays: dto.reviewWindowDays,
      note: dto.note ?? null,
      milestones: dto.milestones,
    });
    return ContractResponseDto.from(contract);
  }

  /** Hợp đồng của dự án. Chưa có / Customer khi chưa gửi ký → 404 CONTRACT_NOT_FOUND. */
  @Roles('ADMIN', 'STAFF', 'CUSTOMER', 'DESIGNER')
  @Get('projects/:projectId/contract')
  async getByProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ContractResponseDto> {
    return ContractResponseDto.from(
      await this.contracts.getByProject(projectId, actor),
    );
  }

  /** Chi tiết hợp đồng kèm lịch thanh toán (không thuộc quyền xem → 404). */
  @Roles('ADMIN', 'STAFF', 'CUSTOMER', 'DESIGNER')
  @Get('contracts/:id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ContractResponseDto> {
    return ContractResponseDto.from(await this.contracts.getById(id, actor));
  }

  /**
   * Staff phụ trách sửa điều khoản; `milestones` có mặt thì thay toàn bộ lịch thanh toán.
   * Chỉ khi DRAFT và chưa gửi ký (422 CONTRACT_NOT_EDITABLE).
   */
  @Roles('STAFF')
  @Patch('contracts/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ContractResponseDto> {
    const contract = await this.contracts.update(id, actor, {
      totalDesignFee: dto.totalDesignFee,
      maxRevisionsPerStage: dto.maxRevisionsPerStage,
      reviewWindowDays: dto.reviewWindowDays,
      note: dto.note,
      milestones: dto.milestones,
    });
    return ContractResponseDto.from(contract);
  }

  /**
   * Staff phụ trách upload PDF hợp đồng chưa ký (multipart field `file`, ≤ 20 MB), lưu SHA-256.
   * Hỏng / mã hóa / quá lớn → 422 INVALID_PDF_FILE; đã gửi ký → 422 CONTRACT_NOT_EDITABLE.
   */
  @Roles('STAFF')
  @Put('contracts/:id/file')
  @UseInterceptors(
    SingleFileUpload('file', MAX_CONTRACT_PDF_BYTES, () => invalidPdfFile()),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody(FILE_BODY)
  async uploadFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile(requiredFile()) file: UploadedFileData,
    @CurrentUser() actor: AuthUser,
  ): Promise<ContractResponseDto> {
    return ContractResponseDto.from(
      await this.contracts.uploadUnsignedFile(id, actor, file),
    );
  }

  /** PDF hợp đồng: bản đã ký nếu có, chưa có thì bản chưa ký. Chưa có file → 404 CONTRACT_FILE_NOT_FOUND. */
  @Roles('ADMIN', 'STAFF', 'CUSTOMER', 'DESIGNER')
  @Get('contracts/:id/file')
  @ApiProduces('application/pdf')
  async downloadFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    const file = await this.contracts.downloadFile(id, actor);
    return new StreamableFile(file.data, {
      type: 'application/pdf',
      length: file.data.length,
      disposition: `inline; filename="${file.fileName}"`,
    });
  }
}
