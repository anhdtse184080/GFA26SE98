import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DesignVersion } from '../designs/entities/design-version.entity.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ContractsController } from './contracts.controller.js';
import { ContractsRepository } from './contracts.repository.js';
import { ContractsService } from './contracts.service.js';
import { ContractSignature } from './entities/contract-signature.entity.js';
import { Contract } from './entities/contract.entity.js';
import { PaymentMilestone } from './entities/payment-milestone.entity.js';

/**
 * `contracts` + `payment_milestones` + `contract_signatures`. Phụ thuộc `projects` (quyền xem / quản lý dự án).
 * `DesignVersion` chỉ đăng ký để TypeORM nạp metadata cho FK `approved_version_id` (module `designs` chưa có).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      PaymentMilestone,
      ContractSignature,
      DesignVersion,
    ]),
    ProjectsModule,
  ],
  controllers: [ContractsController],
  providers: [ContractsService, ContractsRepository],
  exports: [ContractsService],
})
export class ContractsModule {}
