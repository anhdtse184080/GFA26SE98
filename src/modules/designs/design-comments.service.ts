import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { BusinessRuleError, NotFoundError } from '../../common/errors/index.js';
import { UnitOfWork } from '../../database/unit-of-work.js';
import { CommentsRepository } from './comments.repository.js';
import { DesignVersionsRepository } from './design-versions.repository.js';
import { DesignsService } from './designs.service.js';
import { Comment, type PinPosition } from './entities/comment.entity.js';
import { DesignElement } from './entities/design-element.entity.js';
import type { DesignVersion } from './entities/design-version.entity.js';

export interface CommentThread {
  comment: Comment;
  /** Món ở version đang xem (tìm theo `dxf_handle`); `null` = comment không theo món hoặc món đã bị xóa. */
  currentElement: DesignElement | null;
  replies: Comment[];
}

/** Comment nhìn từ một version, kèm nhãn version của giai đoạn (v1, v1.1…). */
export interface VersionComments {
  threads: CommentThread[];
  labels: Map<string, string>;
}

export interface CreateCommentInput {
  content: string;
  designElementId?: string;
  pinPosition?: PinPosition;
  parentCommentId?: string;
}

export type CommentStatusChange =
  | { action: 'ADDRESS'; addressedInVersionId?: string }
  | { action: 'ACCEPT' }
  | { action: 'REOPEN'; reply?: string };

/**
 * Comment trên version / món (DB_CONTEXT §4.5, §6 quy tắc 14), tách khỏi `DesignsService` vì service đó vượt ~600 dòng.
 * Comment nằm ở version nó được viết; xem version mới hơn cùng giai đoạn thì hiện cả comment chưa RESOLVED của các bản trước,
 * tìm lại món theo `dxf_handle`. Log trao đổi: không xóa.
 */
@Injectable()
export class DesignCommentsService {
  constructor(
    private readonly comments: CommentsRepository,
    private readonly versions: DesignVersionsRepository,
    private readonly designs: DesignsService,
    private readonly uow: UnitOfWork,
  ) {}

  /** Comment gốc của version + comment gốc chưa RESOLVED của các bản trước, kèm món ở version đang xem và câu trả lời. */
  async listComments(
    versionId: string,
    actor: AuthUser,
  ): Promise<VersionComments> {
    const { version } = await this.designs.getAccessibleVersion(
      versionId,
      actor,
    );
    const roots = await this.comments.findRootsInScope({
      projectId: version.projectId,
      versionType: version.versionType,
      designVersionId: version.id,
      versionNo: version.versionNo,
    });
    const replies = await this.comments.findReplies(roots.map((c) => c.id));
    const current = await this.elementsByHandle(version.id);
    return {
      threads: roots.map((comment) => ({
        comment,
        currentElement: this.elementAtVersion(comment, version.id, current),
        replies: replies.filter((r) => r.parentCommentId === comment.id),
      })),
      labels: await this.designs.labelsOfStage(version),
    };
  }

  /**
   * Comment gốc (theo món / chỗ trống / chung) chỉ viết trên bản hiện tại. Trả lời (1 tầng) được trên mọi comment gốc
   * đang hiện ở version này; câu trả lời lưu ở version của comment gốc.
   * @throws NotFoundError `COMMENT_NOT_FOUND`
   * @throws BusinessRuleError `VERSION_NOT_CURRENT` | `ELEMENT_NOT_IN_VERSION` | `INVALID_REPLY`
   */
  async createComment(
    versionId: string,
    actor: AuthUser,
    input: CreateCommentInput,
  ): Promise<VersionComments> {
    const { version } = await this.designs.getAccessibleVersion(
      versionId,
      actor,
    );
    const comment: Comment = Object.assign(new Comment(), {
      authorId: actor.id,
      content: input.content,
      status: 'OPEN',
      designElementId: null,
      pinPosition: null,
      parentCommentId: null,
      addressedInVersionId: null,
      proposedProductId: null,
    } satisfies Partial<Comment>);

    if (input.parentCommentId !== undefined) {
      const parent = await this.getCommentOrThrow(input.parentCommentId);
      this.assertCanReply(parent, version, input);
      comment.parentCommentId = parent.id;
      comment.designVersionId = parent.designVersionId;
    } else {
      await this.designs.assertCurrentVersion(version, true);
      if (input.designElementId !== undefined) {
        const element = await this.versions.findElementById(
          input.designElementId,
        );
        if (!element || element.designVersionId !== version.id) {
          throw new BusinessRuleError(
            'ELEMENT_NOT_IN_VERSION',
            'Món không thuộc version này',
            { designElementId: input.designElementId },
          );
        }
        comment.designElementId = element.id;
      }
      comment.designVersionId = version.id;
      comment.pinPosition = input.pinPosition
        ? { x: input.pinPosition.x, y: input.pinPosition.y }
        : null;
    }
    const saved = await this.comments.save(comment);
    return this.threadOf(saved.id, version);
  }

  /**
   * Đổi trạng thái comment gốc (quy tắc 14): Designer ADDRESS (kèm version đã xử lý),
   * khách ACCEPT → RESOLVED hoặc REOPEN ("Not yet", kèm câu trả lời) → OPEN.
   * @throws NotFoundError `COMMENT_NOT_FOUND` | `DESIGN_VERSION_NOT_FOUND`
   * @throws ForbiddenError `NOT_PROJECT_DESIGNER` | `NOT_PROJECT_CUSTOMER`
   * @throws BusinessRuleError `INVALID_COMMENT_STATUS_TRANSITION` | `ADDRESSED_VERSION_REQUIRED`
   *   | `INVALID_ADDRESSED_VERSION` | `REPLY_REQUIRED`
   */
  async changeCommentStatus(
    commentId: string,
    actor: AuthUser,
    change: CommentStatusChange,
  ): Promise<VersionComments> {
    const comment = await this.getCommentOrThrow(commentId);
    const { version, project } = await this.designs.getAccessibleVersion(
      comment.designVersionId,
      actor,
    );
    switch (change.action) {
      case 'ADDRESS': {
        this.designs.assertProjectDesigner(project, actor);
        if (change.addressedInVersionId === undefined) {
          throw new BusinessRuleError(
            'ADDRESSED_VERSION_REQUIRED',
            'Cần chọn version đã xử lý comment (addressedInVersionId)',
          );
        }
        const target = await this.versions.findById(
          change.addressedInVersionId,
        );
        if (
          !target ||
          target.projectId !== version.projectId ||
          target.versionType !== version.versionType ||
          target.versionNo <= version.versionNo
        ) {
          throw new BusinessRuleError(
            'INVALID_ADDRESSED_VERSION',
            'Version đã xử lý phải cùng dự án, cùng giai đoạn và mới hơn version của comment',
            { addressedInVersionId: change.addressedInVersionId },
          );
        }
        comment.markAddressed(target.id);
        await this.comments.save(comment);
        break;
      }
      case 'ACCEPT':
        this.designs.assertProjectCustomer(project, actor);
        comment.resolve();
        await this.comments.save(comment);
        break;
      case 'REOPEN': {
        this.designs.assertProjectCustomer(project, actor);
        const reply = change.reply;
        if (reply === undefined) {
          throw new BusinessRuleError(
            'REPLY_REQUIRED',
            'Cần ghi rõ còn thiếu gì khi trả comment về (reply)',
          );
        }
        await this.uow.run(async () => {
          comment.reopen();
          await this.comments.save(comment);
          await this.comments.save(
            Object.assign(new Comment(), {
              designVersionId: comment.designVersionId,
              parentCommentId: comment.id,
              authorId: actor.id,
              content: reply,
              status: 'OPEN',
              designElementId: null,
              pinPosition: null,
              addressedInVersionId: null,
              proposedProductId: null,
            } satisfies Partial<Comment>),
          );
        });
        break;
      }
    }
    return this.threadOf(comment.id, version);
  }

  // ---------- Private ----------

  /** Kèm version, món. */
  private async getCommentOrThrow(id: string): Promise<Comment> {
    const comment = await this.comments.findById(id);
    if (!comment) throw this.commentNotFound(id);
    return comment;
  }

  private commentNotFound(id: string): NotFoundError {
    return new NotFoundError('COMMENT_NOT_FOUND', 'Không tìm thấy comment', {
      commentId: id,
    });
  }

  /**
   * Trả lời: comment gốc, cùng dự án và giai đoạn, ở version này hoặc bản trước; chỉ có nội dung.
   * @throws BusinessRuleError `INVALID_REPLY`
   */
  private assertCanReply(
    parent: Comment,
    version: DesignVersion,
    input: CreateCommentInput,
  ): void {
    const parentVersion = parent.designVersion;
    let reason: string | null = null;
    if (!parent.isRoot()) {
      reason = 'Chỉ trả lời được comment gốc (1 tầng)';
    } else if (
      !parentVersion ||
      parentVersion.projectId !== version.projectId ||
      parentVersion.versionType !== version.versionType ||
      parentVersion.versionNo > version.versionNo
    ) {
      reason = 'Comment gốc không hiện ở version này';
    } else if (
      input.designElementId !== undefined ||
      input.pinPosition !== undefined
    ) {
      reason = 'Câu trả lời không gắn món hay điểm ghim';
    }
    if (reason) {
      throw new BusinessRuleError('INVALID_REPLY', reason, {
        parentCommentId: parent.id,
      });
    }
  }

  private async elementsByHandle(
    versionId: string,
  ): Promise<Map<string, DesignElement>> {
    return DesignElement.indexByHandle(
      await this.versions.findElements(versionId),
    );
  }

  /** Món của comment ở version đang xem: chính món đó nếu cùng version, không thì tìm theo `dxf_handle`. */
  private elementAtVersion(
    comment: Comment,
    versionId: string,
    current: Map<string, DesignElement>,
  ): DesignElement | null {
    const element = comment.designElement ?? null;
    if (!element) return null;
    if (comment.designVersionId === versionId) return element;
    return element.dxfHandle ? (current.get(element.dxfHandle) ?? null) : null;
  }

  /** Một comment (gốc kèm các câu trả lời, hoặc một câu trả lời), nhìn từ `version`. */
  private async threadOf(
    commentId: string,
    version: DesignVersion,
  ): Promise<VersionComments> {
    const comment = await this.comments.findDetailById(commentId);
    if (!comment) throw this.commentNotFound(commentId);
    const current = await this.elementsByHandle(version.id);
    return {
      threads: [
        {
          comment,
          currentElement: this.elementAtVersion(comment, version.id, current),
          replies: comment.isRoot()
            ? await this.comments.findReplies([comment.id])
            : [],
        },
      ],
      labels: await this.designs.labelsOfStage(version),
    };
  }
}
