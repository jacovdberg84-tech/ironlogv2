import type { DashboardSection, RouteSection } from "./dashboardTypes";

type SiteRouteControlPanelProps = {
  enterpriseSiteCode: string;
  siteRoleLabel: string;
  activeSection: DashboardSection;
  routeSections: RouteSection[];
  onNavigate: (section: DashboardSection) => void;
};

const sectionPanelIds: Record<DashboardSection, string> = {
  overview: "overview-section-panel",
  ironmind: "ironmind-section-panel",
  departments: "departments-section-panel",
  enterprise: "enterprise-section-panel",
  admin: "admin-section-panel"
};

export function SiteRouteControlPanel({
  enterpriseSiteCode,
  siteRoleLabel,
  activeSection,
  routeSections,
  onNavigate
}: SiteRouteControlPanelProps) {
  const activeSectionLabel = activeSection.charAt(0).toUpperCase() + activeSection.slice(1);

  return (
    <section className="panel" aria-labelledby="route-control-heading">
      <h3 id="route-control-heading">Site Route Control</h3>
      <div className="route-context-row">
        <p className="admin-note">Site: {enterpriseSiteCode}</p>
        <div className="route-pill-row">
          <span className="section-badge">Section: {activeSectionLabel}</span>
          <span className="site-role-pill">Role: {siteRoleLabel}</span>
        </div>
      </div>
      <div className="route-grid" role="tablist" aria-label="Dashboard section navigation">
        {routeSections.map((section) => (
          <button
            key={section.key}
            id={`tab-${section.key}`}
            type="button"
            role="tab"
            aria-selected={activeSection === section.key}
            aria-controls={sectionPanelIds[section.key]}
            className={`route-btn ${activeSection === section.key ? "active" : ""}`}
            onClick={() => onNavigate(section.key)}
            disabled={!section.enabled}
          >
            {section.label}
          </button>
        ))}
      </div>
    </section>
  );
}
