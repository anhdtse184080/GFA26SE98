import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Phong cách thiết kế (Minimalist, Japandi…). Không xóa: ẩn bằng `is_active`. */
@Entity({ name: 'design_styles' })
@Unique('uq_design_styles_code', ['code'])
export class DesignStyle {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_design_styles',
  })
  id: string;

  @Column({ name: 'code', type: 'varchar', length: 50 })
  code: string;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** `undefined` = giữ nguyên, `null` = xóa (cột nullable). Không đổi `code`. */
  update(patch: DesignStylePatch): void {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(this, { [key]: value });
    }
  }
}

export type DesignStylePatch = Partial<
  Pick<DesignStyle, 'name' | 'description' | 'imageUrl' | 'isActive'>
>;
