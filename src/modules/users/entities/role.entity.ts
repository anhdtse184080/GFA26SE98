import { Check, Column, Entity, PrimaryColumn, Unique } from 'typeorm';
import { sqlIn } from '../../../database/postgres/sql-check.js';
import { ROLE_CODES, type RoleCode } from '../role-code.enum.js';

@Entity({ name: 'roles' })
@Unique('uq_roles_code', ['code'])
@Check('chk_roles_code', sqlIn('code', ROLE_CODES))
export class Role {
  @PrimaryColumn({
    name: 'id',
    type: 'smallint',
    primaryKeyConstraintName: 'pk_roles',
  })
  id: number;

  @Column({ name: 'code', type: 'varchar', length: 20 })
  code: RoleCode;

  @Column({ name: 'name', type: 'varchar', length: 100 })
  name: string;
}
