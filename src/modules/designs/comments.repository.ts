import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { TransactionContext } from '../../database/transaction-context.js';
import type { DesignVersionType } from './entities/design-version.entity.js';
import { Comment } from './entities/comment.entity.js';

/** Một version trong phạm vi xem comment: version đang xem + các bản trước cùng giai đoạn. */
export interface CommentScope {
  projectId: string;
  versionType: DesignVersionType;
  designVersionId: string;
  versionNo: number;
}

/** `comments`: log trao đổi, không có `delete`. */
@Injectable()
export class CommentsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(Comment);
  }

  /** Kèm version (để biết dự án, giai đoạn) và món (để biết `dxf_handle`). */
  findById(id: string): Promise<Comment | null> {
    return this.repo.findOne({
      where: { id },
      relations: { designVersion: true, designElement: true },
    });
  }

  /**
   * Comment gốc của version đang xem + comment gốc chưa RESOLVED của các bản trước cùng giai đoạn
   * (DB_CONTEXT §6 quy tắc 14), kèm tác giả, món, version; cũ trước.
   */
  findRootsInScope(scope: CommentScope): Promise<Comment[]> {
    return this.withDetails()
      .andWhere('c.parent_comment_id IS NULL')
      .andWhere('v.project_id = :projectId', { projectId: scope.projectId })
      .andWhere('v.version_type = :versionType', {
        versionType: scope.versionType,
      })
      .andWhere(
        `(c.design_version_id = :designVersionId OR (v.version_no < :versionNo AND c.status <> 'RESOLVED'))`,
        {
          designVersionId: scope.designVersionId,
          versionNo: scope.versionNo,
        },
      )
      .orderBy('c.created_at', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getMany();
  }

  /** Câu trả lời của các comment gốc, cũ trước. */
  findReplies(parentIds: readonly string[]): Promise<Comment[]> {
    if (!parentIds.length) return Promise.resolve([]);
    return this.withDetails()
      .andWhere('c.parent_comment_id IN (:...parentIds)', {
        parentIds: [...parentIds],
      })
      .orderBy('c.created_at', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getMany();
  }

  /** Một comment kèm đủ thông tin để trả về API. */
  findDetailById(id: string): Promise<Comment | null> {
    return this.withDetails().andWhere('c.id = :id', { id }).getOne();
  }

  findByIds(ids: readonly string[]): Promise<Comment[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.repo.find({ where: { id: In([...ids]) } });
  }

  save(comment: Comment): Promise<Comment> {
    return this.repo.save(comment);
  }

  private withDetails() {
    return this.repo
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.designVersion', 'v')
      .innerJoinAndSelect('c.author', 'a')
      .innerJoinAndSelect('a.role', 'r')
      .leftJoinAndSelect('c.designElement', 'e');
  }
}
