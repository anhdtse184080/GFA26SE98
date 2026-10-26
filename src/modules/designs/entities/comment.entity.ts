import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { Product } from '../../products/entities/product.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { DesignElement } from './design-element.entity.js';
import { DesignVersion } from './design-version.entity.js';

/** Chỉ comment gốc dùng trạng thái; câu trả lời (`parent_comment_id` khác null) bỏ qua giá trị này. */
export const COMMENT_STATUSES = ['OPEN', 'ADDRESSED', 'RESOLVED'] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

/** Điểm ghim trên mặt bằng (mét). */
export interface PinPosition {
  x: number;
  y: number;
}

/**
 * Nhận xét trên version / vật thể, trả lời 1 tầng qua `parent_comment_id`. Log trao đổi: không xóa.
 * Loại comment suy ra: có `design_element_id` = theo món; chỉ có `pin_position` = chỗ trống; cả hai null = chung.
 */
@Entity({ name: 'comments' })
@Index('idx_comments_design_version_id', ['designVersionId'])
@Index('idx_comments_parent_comment_id', ['parentCommentId'])
@Index('idx_comments_design_element_id', ['designElementId'])
@Check('chk_comments_status', sqlIn('status', COMMENT_STATUSES))
@Check('chk_comments_parent_comment_id', '"parent_comment_id" <> "id"')
export class Comment {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_comments' })
  id: string;

  @Column({ name: 'design_version_id', type: 'uuid' })
  designVersionId: string;

  @ManyToOne(() => DesignVersion, { nullable: false })
  @JoinColumn({
    name: 'design_version_id',
    foreignKeyConstraintName: 'fk_comments_design_version_id',
  })
  designVersion?: Relation<DesignVersion>;

  @Column({ name: 'design_element_id', type: 'uuid', nullable: true })
  designElementId: string | null;

  @ManyToOne(() => DesignElement, { nullable: true })
  @JoinColumn({
    name: 'design_element_id',
    foreignKeyConstraintName: 'fk_comments_design_element_id',
  })
  designElement?: Relation<DesignElement> | null;

  @Column({ name: 'parent_comment_id', type: 'uuid', nullable: true })
  parentCommentId: string | null;

  @ManyToOne(() => Comment, { nullable: true })
  @JoinColumn({
    name: 'parent_comment_id',
    foreignKeyConstraintName: 'fk_comments_parent_comment_id',
  })
  parentComment?: Relation<Comment> | null;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'author_id',
    foreignKeyConstraintName: 'fk_comments_author_id',
  })
  author?: Relation<User>;

  @Column({ name: 'content', type: 'text' })
  content: string;

  @Column({ name: 'pin_position', type: 'jsonb', nullable: true })
  pinPosition: PinPosition | null;

  @Column({ name: 'status', type: 'varchar', length: 20, default: 'OPEN' })
  status: CommentStatus;

  /** Designer tick "đã xử lý ở version N" (cùng dự án, cùng `version_type`). */
  @Column({ name: 'addressed_in_version_id', type: 'uuid', nullable: true })
  addressedInVersionId: string | null;

  @ManyToOne(() => DesignVersion, { nullable: true })
  @JoinColumn({
    name: 'addressed_in_version_id',
    foreignKeyConstraintName: 'fk_comments_addressed_in_version_id',
  })
  addressedInVersion?: Relation<DesignVersion> | null;

  /** Khách thử mẫu khác rồi gửi yêu cầu đổi; Designer áp dụng thì tạo version `EDIT`. */
  @Column({ name: 'proposed_product_id', type: 'uuid', nullable: true })
  proposedProductId: string | null;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({
    name: 'proposed_product_id',
    foreignKeyConstraintName: 'fk_comments_proposed_product_id',
  })
  proposedProduct?: Relation<Product> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
