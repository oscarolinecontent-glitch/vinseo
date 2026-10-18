export interface SiteConfig {
  wp_url: string;
  wp_user: string;
  wp_app_pass: string;
  wp_password?: string;
  wp_login_path?: string;
  image_format?: string;
  image_width?: number;
  image_height?: number;
  authHeaders?: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  url: string;
  wp_user: string;
  wp_app_pass: string;
  wp_password?: string;
  wp_login_path?: string;
  image_format?: string;
  image_width?: string;
  image_height?: string;
}

export interface WpMedia {
  id: number;
  source_url: string;
  slug?: string;
  media_details?: { width?: number; height?: number };
}

export interface MediaMatch {
  id: number;
  url: string;
  w?: number;
  h?: number;
}

export interface WpPostMatch {
  id: number;
  slug: string;
  link?: string;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi. Vui lòng thử lại.';
}
