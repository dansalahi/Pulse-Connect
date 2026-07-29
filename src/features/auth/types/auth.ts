/**
 * Auth domain types shared between authStore and the Rust auth manager's
 * IPC responses — keep in sync with the corresponding Rust structs/enums.
 */
export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
}

export type AppErrorCode =
  | "INVALID_CREDENTIALS"
  | "REFRESH_FAILED"
  | "NOT_AUTHENTICATED"
  | "KEYCHAIN_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN"
  | "VALIDATION"
  | "INTERNAL";

export interface AppError {
  code: AppErrorCode;
  message: string;
}
