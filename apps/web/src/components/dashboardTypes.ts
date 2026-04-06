export type DashboardSection = "overview" | "ironmind" | "departments" | "enterprise" | "admin";

export type RouteSection = {
  key: DashboardSection;
  label: string;
  enabled: boolean;
};
