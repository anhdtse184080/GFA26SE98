import { Injectable } from '@nestjs/common';
import { isUniqueViolation } from '../../database/postgres/unique-violation.js';
import { TransactionContext } from '../../database/transaction-context.js';
import { DesignAsset } from './entities/design-asset.entity.js';
import { DesignElement } from './entities/design-element.entity.js';
import {
  DesignVersion,
  type DesignVersionType,
} from './entities/design-version.entity.js';
import {
  ProductSelection,
  type SelectionData,
} from './entities/product-selection.entity.js';

/** Nội dung ghi cùng một version mới (chưa có `design_version_id`); `selection` = sản phẩm đã chọn (nếu có). */
export type NewVersionElement = Omit<
  DesignElement,
  | 'id'
  | 'designVersionId'
  | 'designVersion'
  | 'room'
  | 'category'
  | 'selection'
  | 'createdAt'
> & { selection?: SelectionData | null };
export type NewVersionAsset = Omit<
  DesignAsset,
  | 'id'
  | 'designVersionId'
  | 'designVersion'
  | 'project'
  | 'uploadedBy'
  | 'createdAt'
>;

/**
 * `design_versions` + `design_elements` + `design_assets` + `product_selections` của version
 * (selection luôn ghi cùng món khi tạo version). Không xóa version.
 */
@Injectable()
export class DesignVersionsRepository {
  constructor(private readonly tx: TransactionContext) {}

  private get repo() {
    return this.tx.manager.getRepository(DesignVersion);
  }

  private get elements() {
    return this.tx.manager.getRepository(DesignElement);
  }

  private get assets() {
    return this.tx.manager.getRepository(DesignAsset);
  }

  private get selections() {
    return this.tx.manager.getRepository(ProductSelection);
  }

  findById(id: string): Promise<DesignVersion | null> {
    return this.repo.findOne({ where: { id }, relations: { createdBy: true } });
  }

  /** Các version của một giai đoạn, theo `version_no` tăng dần. */
  findByStage(
    projectId: string,
    versionType: DesignVersionType,
  ): Promise<DesignVersion[]> {
    return this.repo.find({
      where: { projectId, versionType },
      relations: { createdBy: true },
      order: { versionNo: 'ASC' },
    });
  }

  /** Như `findByStage` nhưng khóa các dòng (`FOR UPDATE`) đến hết transaction: tuần tự hóa upload / duyệt / lưu. */
  findByStageForUpdate(
    projectId: string,
    versionType: DesignVersionType,
  ): Promise<DesignVersion[]> {
    return this.repo.find({
      where: { projectId, versionType },
      order: { versionNo: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Món của version, kèm danh mục và sản phẩm đã chọn (+ supplier), chỉ đọc. */
  findElements(designVersionId: string): Promise<DesignElement[]> {
    return this.elements.find({
      where: { designVersionId },
      relations: {
        category: true,
        selection: { product: { supplier: true } },
      },
      order: { blockName: 'ASC', dxfHandle: 'ASC' },
    });
  }

  findElementById(id: string): Promise<DesignElement | null> {
    return this.elements.findOne({ where: { id } });
  }

  /** Món kèm version (dự án, `scene_json`) và sản phẩm đã chọn. */
  findElementWithVersion(id: string): Promise<DesignElement | null> {
    return this.elements.findOne({
      where: { id },
      relations: { designVersion: true, selection: true },
    });
  }

  /** File DXF của version (`asset_type = DRAWING_2D`). */
  findDrawing(designVersionId: string): Promise<DesignAsset | null> {
    return this.assets.findOne({
      where: { designVersionId, assetType: 'DRAWING_2D' },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Tạo version + món (+ sản phẩm đã chọn) + file trong transaction hiện tại.
   * Trùng `(project_id, version_type, version_no)` → `null`.
   */
  async createWithContent(
    version: DesignVersion,
    elements: readonly NewVersionElement[],
    asset: NewVersionAsset | null,
  ): Promise<DesignVersion | null> {
    let saved: DesignVersion;
    try {
      saved = await this.repo.save(version);
    } catch (error) {
      if (
        isUniqueViolation(
          error,
          'uq_design_versions_project_id_version_type_version_no',
        )
      ) {
        return null;
      }
      throw error;
    }
    if (elements.length > 0) {
      const created = await this.elements.save(
        // `selection` ghi riêng bên dưới (cần id của món), không để TypeORM tự xử lý quan hệ
        elements.map((e) =>
          Object.assign(new DesignElement(), e, {
            designVersionId: saved.id,
            selection: undefined,
          }),
        ),
      );
      const selections = elements.flatMap((e, i) =>
        e.selection
          ? [
              Object.assign(new ProductSelection(), e.selection, {
                designElementId: created[i].id,
              }),
            ]
          : [],
      );
      if (selections.length > 0) await this.selections.save(selections);
    }
    if (asset) {
      await this.assets.save(
        Object.assign(new DesignAsset(), asset, { designVersionId: saved.id }),
      );
    }
    return saved;
  }

  /** Chỉ ghi trạng thái và thời điểm duyệt. */
  async saveStatuses(versions: readonly DesignVersion[]): Promise<void> {
    for (const v of versions) {
      await this.repo.update(
        { id: v.id },
        { status: v.status, approvedAt: v.approvedAt },
      );
    }
  }
}
