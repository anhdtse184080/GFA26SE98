import type { DesignStyle } from '../entities/design-style.entity.js';

export class DesignStyleResponseDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isActive: boolean;

  static from(style: DesignStyle): DesignStyleResponseDto {
    return Object.assign(new DesignStyleResponseDto(), {
      id: style.id,
      code: style.code,
      name: style.name,
      description: style.description,
      imageUrl: style.imageUrl,
      isActive: style.isActive,
    });
  }
}
