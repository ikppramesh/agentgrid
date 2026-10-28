import type { Role } from "@prisma/client";

export type Permission =
  | "tenant:read"
  | "tenant:manage" // settings, branding, retention, SSO, members
  | "agent:manage"
  | "conversation:read"
  | "conversation:reply"
  | "pii:read" // see decrypted original messages / contact profile
  | "privacy:erase"
  | "billing:read"
  | "audit:read"
  | "clients:manage"; // agency: create / sandbox client tenants

const MATRIX: Record<Role, Permission[]> = {
  OWNER: [
    "tenant:read",
    "tenant:manage",
    "agent:manage",
    "conversation:read",
    "conversation:reply",
    "pii:read",
    "privacy:erase",
    "billing:read",
    "audit:read",
    "clients:manage",
  ],
  ADMIN: [
    "tenant:read",
    "tenant:manage",
    "agent:manage",
    "conversation:read",
    "conversation:reply",
    "pii:read",
    "privacy:erase",
    "billing:read",
    "audit:read",
    "clients:manage",
  ],
  OPERATOR: ["tenant:read", "conversation:read", "conversation:reply", "pii:read"],
  VIEWER: ["tenant:read", "conversation:read", "billing:read"],
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export const ROLE_RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2, OWNER: 3 };
