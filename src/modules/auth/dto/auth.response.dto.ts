import type { DesignerProfile } from '../../users/entities/designer-profile.entity.js';
import type { SupplierProfile } from '../../users/entities/supplier-profile.entity.js';
import type { User } from '../../users/entities/user.entity.js';
import type { PartnershipStatus } from '../../users/partnership-status.js';
import { type RoleCode, roleCodeOf } from '../../users/role-code.enum.js';
import type { UserStatus } from '../../users/user-status.js';

/** Thông tin user trả ra API: không có `password_hash`. */
export class UserResponseDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
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
      avatarUrl: user.avatarUrl,
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

/** GET /auth/me: user + profile (designer/supplier), các role khác `profile = null`. */
export class MeResponseDto extends UserResponseDto {
  profile: DesignerProfileResponseDto | SupplierProfileResponseDto | null;

  static fromWithProfile(user: User): MeResponseDto {
    const profile = user.designerProfile
      ? DesignerProfileResponseDto.from(user.designerProfile)
      : user.supplierProfile
        ? SupplierProfileResponseDto.from(user.supplierProfile)
        : null;
    return Object.assign(new MeResponseDto(), UserResponseDto.from(user), {
      profile,
    });
  }
}

export class LoginResponseDto {
  accessToken: string;
  user: UserResponseDto;
}

export class MessageResponseDto {
  message: string;
}

export class RegisterResponseDto extends MessageResponseDto {
  user: UserResponseDto;
}
