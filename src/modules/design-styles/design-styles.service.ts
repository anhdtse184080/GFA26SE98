import { Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../common/errors/index.js';
import {
  DesignStylesRepository,
  type NewDesignStyle,
} from './design-styles.repository.js';
import type {
  DesignStyle,
  DesignStylePatch,
} from './entities/design-style.entity.js';

/** Phong cách thiết kế: mọi user đăng nhập xem, Admin tạo/sửa/ẩn. */
@Injectable()
export class DesignStylesService {
  constructor(private readonly styles: DesignStylesRepository) {}

  list(isActive?: boolean): Promise<DesignStyle[]> {
    return this.styles.findAll(isActive);
  }

  /** Style theo danh sách id (bỏ qua id không tồn tại; caller tự đối chiếu). */
  findByIds(ids: readonly string[]): Promise<DesignStyle[]> {
    return this.styles.findByIds(ids);
  }

  /** @throws NotFoundError `DESIGN_STYLE_NOT_FOUND` */
  async get(id: string): Promise<DesignStyle> {
    const style = await this.styles.findById(id);
    if (!style) {
      throw new NotFoundError(
        'DESIGN_STYLE_NOT_FOUND',
        'Không tìm thấy phong cách thiết kế',
      );
    }
    return style;
  }

  /** @throws ConflictError `DESIGN_STYLE_CODE_EXISTS` */
  async create(input: NewDesignStyle): Promise<DesignStyle> {
    const style = await this.styles.createIfCodeAvailable(input);
    if (!style) {
      throw new ConflictError(
        'DESIGN_STYLE_CODE_EXISTS',
        'Mã phong cách đã tồn tại',
        { code: input.code },
      );
    }
    return style;
  }

  /** @throws NotFoundError `DESIGN_STYLE_NOT_FOUND` */
  async update(id: string, patch: DesignStylePatch): Promise<DesignStyle> {
    const style = await this.get(id);
    style.update(patch);
    return this.styles.save(style);
  }
}
