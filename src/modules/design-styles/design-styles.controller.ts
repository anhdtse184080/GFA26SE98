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
import { Roles } from '../../common/auth/decorators.js';
import { DesignStylesService } from './design-styles.service.js';
import {
  CreateDesignStyleDto,
  ListDesignStylesQueryDto,
  UpdateDesignStyleDto,
} from './dto/design-styles.dto.js';
import { DesignStyleResponseDto } from './dto/design-styles.response.dto.js';

/** `/design-styles` (mọi user đăng nhập), `/admin/design-styles` (Admin). Không có DELETE: ẩn bằng `isActive`. */
@ApiTags('design-styles')
@Controller()
export class DesignStylesController {
  constructor(private readonly styles: DesignStylesService) {}

  /** Danh sách phong cách thiết kế (ít bản ghi, không phân trang). */
  @Get('design-styles')
  async list(
    @Query() query: ListDesignStylesQueryDto,
  ): Promise<DesignStyleResponseDto[]> {
    const styles = await this.styles.list(query.isActive);
    return styles.map((style) => DesignStyleResponseDto.from(style));
  }

  @Get('design-styles/:id')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DesignStyleResponseDto> {
    return DesignStyleResponseDto.from(await this.styles.get(id));
  }

  /** Tạo phong cách thiết kế. Trùng `code` → 409 DESIGN_STYLE_CODE_EXISTS. */
  @Roles('ADMIN')
  @Post('admin/design-styles')
  async create(
    @Body() dto: CreateDesignStyleDto,
  ): Promise<DesignStyleResponseDto> {
    const style = await this.styles.create({
      code: dto.code,
      name: dto.name,
      description: dto.description ?? null,
      imageUrl: dto.imageUrl ?? null,
      isActive: dto.isActive ?? true,
    });
    return DesignStyleResponseDto.from(style);
  }

  /** Sửa tên, mô tả, ảnh; `isActive: false` để ẩn. Không đổi `code`. */
  @Roles('ADMIN')
  @Patch('admin/design-styles/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDesignStyleDto,
  ): Promise<DesignStyleResponseDto> {
    const style = await this.styles.update(id, {
      name: dto.name,
      description: dto.description,
      imageUrl: dto.imageUrl,
      isActive: dto.isActive,
    });
    return DesignStyleResponseDto.from(style);
  }
}
