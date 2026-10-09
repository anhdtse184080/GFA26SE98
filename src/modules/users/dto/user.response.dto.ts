import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { DesignerProfile } from '../entities/designer-profile.entity.js';
import type { SupplierProfile } from '../entities/supplier-profile.entity.js';
import type { User } from '../entities/user.entity.js';
import type { PartnershipStatus } from '../partnership-status.js';
import { type RoleCode, roleCodeOf } from '../role-code.enum.js';
import type { UserStatus } from '../user-status.js';

/** Thông tin user trả ra API: không có `password_hash`. */
export class UserResponseDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: RoleCode;
  status: UserStatus;
  activatedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;

  static from(user: User): UserResponseDto {
    return Object.assign(new UserResponseDto(), {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      role: roleCodeOf(user.roleId),
      status: user.status,
      activatedAt: user.activatedAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    });
  }
}

export class DesignerProfileResponseDto {
  type: 'DESIGNER';
  employeeCode: string;
  title: string | null;
  specialization: string | null;
  yearsOfExperience: number | null;
  bio: string | null;
  isAvailable: boolean;
  ratingAvg: string;
  ratingCount: number;

  static from(p: DesignerProfile): DesignerProfileResponseDto {
    return Object.assign(new DesignerProfileResponseDto(), {
      type: 'DESIGNER',
      employeeCode: p.employeeCode,
      title: p.title,
      specialization: p.specialization,
      yearsOfExperience: p.yearsOfExperience,
      bio: p.bio,
      isAvailable: p.isAvailable,
      ratingAvg: p.ratingAvg,
      ratingCount: p.ratingCount,
    });
  }
}

export class SupplierProfileResponseDto {
  type: 'SUPPLIER';
  companyName: string;
  taxCode: string;
  businessAddress: string;
  contactName: string | null;
  contactPhone: string | null;
  website: string | null;
  partnershipStatus: PartnershipStatus;
  partnerSince: string | null;

  static from(p: SupplierProfile): SupplierProfileResponseDto {
    return Object.assign(new SupplierProfileResponseDto(), {
      type: 'SUPPLIER',
      companyName: p.companyName,
      taxCode: p.taxCode,
      businessAddress: p.businessAddress,
      contactName: p.contactName,
      contactPhone: p.contactPhone,
      website: p.website,
      partnershipStatus: p.partnershipStatus,
      partnerSince: p.partnerSince,
    });
  }
}

/** User + profile (designer/supplier), các role khác `profile = null`. Dùng cho `/auth/me`, `/admin/users`. */
@ApiExtraModels(DesignerProfileResponseDto, SupplierProfileResponseDto)
export class UserDetailResponseDto extends UserResponseDto {
  @ApiProperty({
    nullable: true,
    description: 'Profile theo role (phân biệt bằng `type`); role khác → null',
    oneOf: [
      { $ref: getSchemaPath(DesignerProfileResponseDto) },
      { $ref: getSchemaPath(SupplierProfileResponseDto) },
    ],
  })
  profile: DesignerProfileResponseDto | SupplierProfileResponseDto | null;

  static from(user: User): UserDetailResponseDto {
    const profile = user.designerProfile
      ? DesignerProfileResponseDto.from(user.designerProfile)
      : user.supplierProfile
        ? SupplierProfileResponseDto.from(user.supplierProfile)
        : null;
    return Object.assign(
      new UserDetailResponseDto(),
      UserResponseDto.from(user),
      {
        profile,
      },
    );
  }
}

export class CreateAccountResponseDto {
  message: string;
  user: UserDetailResponseDto;
}

export class InvitationSentResponseDto {
  message: string;
}

/** Kết quả tra cứu customer để mời vào dự án: chỉ thông tin liên hệ tối thiểu. */
export class CustomerLookupResponseDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;

  static from(user: User): CustomerLookupResponseDto {
    return Object.assign(new CustomerLookupResponseDto(), {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
    });
  }
}

export class UserPageResponseDto {
  items: UserResponseDto[];
  page: number;
  limit: number;
  total: number;

  static from(page: Paginated<User>): UserPageResponseDto {
    return Object.assign(new UserPageResponseDto(), {
      items: page.items.map((user) => UserResponseDto.from(user)),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  }
}
