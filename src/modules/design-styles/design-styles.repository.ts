import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { DesignStyle } from './entities/design-style.entity.js';

export type NewDesignStyle = Pick<
  DesignStyle,
  'code' | 'name' | 'description' | 'imageUrl' | 'isActive'
>;

/** `design_styles`. Không có `delete`: ẩn bằng `is_active`. */
@Injectable()
export class DesignStylesRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(DesignStyle);
  }

  findById(id: string): Promise<DesignStyle | null> {
    return this.repo.findOne({ where: { id } });
  }

  findAll(isActive?: boolean): Promise<DesignStyle[]> {
    return this.repo.find({
      where: isActive === undefined ? {} : { isActive },
      order: { name: 'ASC' },
    });
  }

  /** Trùng `code` → `null`. */
  async createIfCodeAvailable(
    style: NewDesignStyle,
  ): Promise<DesignStyle | null> {
    try {
      return await this.repo.save(this.repo.create(style));
    } catch (error) {
      if (isUniqueViolation(error, 'uq_design_styles_code')) return null;
      throw error;
    }
  }

  save(style: DesignStyle): Promise<DesignStyle> {
    return this.repo.save(style);
  }
}
