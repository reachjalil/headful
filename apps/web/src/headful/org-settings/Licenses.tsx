/* oxlint-disable shadcn/no-unknown-classes -- Org settings owns its scoped Headful surface. */
import { useState } from "react";
import { Info, Search } from "lucide-react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import type { SetupDispatch } from "../setup-service";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { ReadFrame, useRead } from "./read";

type Inventory = HeadfulResult<"orgs.licenses">;
type License = Inventory["groups"][number]["licenses"][number];
type Kind = Inventory["groups"][number]["kind"];
const groups = {
  user: {
    title: "User licenses",
    short: "Base access",
    description:
      "Each user has one base license. This determines which profiles and features they can use.",
  },
  "permission-set": {
    title: "Feature licenses",
    short: "Permission set licenses",
    description:
      "Extra feature entitlements that supplement a user license. One user can hold several; a license still needs the right permissions to grant access.",
  },
  package: {
    title: "Package licenses",
    short: "Managed packages",
    description:
      "Access to installed managed packages, identified by their namespace. This inventory covers packages that report a license record.",
  },
} as const;
const number = (value: number | null) => (value === null ? "—" : value.toLocaleString());
const date = (value: string) =>
  new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(value.length === 10 ? { timeZone: "UTC" } : {}),
  });

export function licenseCapacity(total: number | null, used: number | null) {
  return {
    available: total === null || used === null ? null : Math.max(0, total - used),
    over: total === null || used === null ? 0 : Math.max(0, used - total),
    percent: total !== null && total > 0 && used !== null ? (used / total) * 100 : null,
  };
}
export function licenseExpiry(expiresAt: string | null, checkedAt: string) {
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return null;
  // A date-only entitlement is valid through its stated expiry day.
  const checked = Date.parse(checkedAt);
  const end = Date.parse(expiresAt.length === 10 ? `${expiresAt}T23:59:59.999Z` : expiresAt);
  const days = Math.ceil((end - checked) / 86400000);
  return { expired: end < checked, soon: days >= 0 && days <= 30, days };
}
export function licenseNeedsAttention(license: License, checkedAt: string) {
  const capacity = licenseCapacity(license.total, license.used);
  const monthly = license.monthlyLogins
    ? licenseCapacity(license.monthlyLogins.total, license.monthlyLogins.used)
    : null;
  const expiry = licenseExpiry(license.expiresAt, checkedAt);
  return (
    capacity.over > 0 ||
    (capacity.percent ?? 0) >= 80 ||
    (monthly?.percent ?? 0) >= 80 ||
    (monthly?.over ?? 0) > 0 ||
    expiry?.expired === true ||
    expiry?.soon === true ||
    /^(disabled|expired|suspended|uninstalled)$/i.test(license.status ?? "")
  );
}

function Capacity({
  total,
  used,
  monthly = false,
}: {
  total: number | null;
  used: number | null;
  monthly?: boolean;
}) {
  const capacity = licenseCapacity(total, used);
  return (
    <div className="os-license-capacity">
      {monthly && <strong className="os-capacity-label">Monthly logins</strong>}
      <dl>
        <div>
          <dt>{monthly ? "Used" : "Assigned"}</dt>
          <dd>{number(used)}</dd>
        </div>
        <div>
          <dt>{monthly ? "Remaining" : "Available"}</dt>
          <dd>{number(capacity.available)}</dd>
        </div>
        <div>
          <dt>{monthly ? "Monthly allowance" : "Total allowance"}</dt>
          <dd>{number(total)}</dd>
        </div>
      </dl>
      {capacity.percent !== null && (
        <progress
          className={capacity.percent >= 80 ? "warning" : ""}
          max={100}
          value={Math.min(100, capacity.percent)}
          aria-label={monthly ? "Monthly logins used" : "License allowance assigned"}
        />
      )}
      <p>
        {capacity.over > 0
          ? `${number(capacity.over)} above reported allowance`
          : total === null
            ? "No numeric allowance reported"
            : used === null
              ? "Assigned usage not reported"
              : total === 0
                ? "No allocated capacity"
                : `${Math.round(capacity.percent ?? 0)}% ${monthly ? "used" : "assigned"}`}
      </p>
    </div>
  );
}

export function Licenses({ orgId, dispatch }: { orgId: string; dispatch: SetupDispatch }) {
  const read = useRead(dispatch, "orgs.licenses", { orgId });
  const [kind, setKind] = useState<Kind>("user");
  const [search, setSearch] = useState("");
  const [attention, setAttention] = useState(false);
  const inventory = read.data?.groups.find((g) => g.kind === kind);
  const checkedAt = read.data?.checkedAt ?? "";
  const licenses = [...(inventory?.licenses ?? [])].sort(
    (a, b) =>
      Number(licenseNeedsAttention(b, checkedAt)) - Number(licenseNeedsAttention(a, checkedAt)) ||
      a.name.localeCompare(b.name),
  );
  const filtered = licenses.filter(
    (l) =>
      `${l.name} ${l.apiName} ${l.status ?? ""}`.toLowerCase().includes(search.toLowerCase()) &&
      (!attention || licenseNeedsAttention(l, checkedAt)),
  );
  const needsAttention = licenses.filter((l) => licenseNeedsAttention(l, checkedAt)).length;
  return (
    <ReadFrame
      title="Licenses & capacity"
      description="Understand your entitlements before adding people or features."
      source="Salesforce license inventories · Selected org and login"
      read={read}
    >
      {read.data && (
        <>
          <div className="os-license-groups" aria-label="License categories">
            {read.data.groups.map((group) => (
              <button
                key={group.kind}
                data-testid={`org-settings-license-${group.kind}`}
                aria-pressed={kind === group.kind}
                onClick={() => setKind(group.kind)}
              >
                <strong>{groups[group.kind].title}</strong>
                <small>
                  {group.availability === "unavailable"
                    ? "Unavailable"
                    : `${group.licenses.length}${group.capped ? "+" : ""} types · ${group.licenses.filter((l) => licenseNeedsAttention(l, checkedAt)).length} to review`}
                </small>
              </button>
            ))}
          </div>
          <SettingsDisclosure
            id={`license-guide-${kind}`}
            title={`About ${groups[kind].title.toLowerCase()}`}
            hint={groups[kind].short}
          >
            <p>{groups[kind].description}</p>
            <p>Review at 80% assigned or used, expiry within 30 days, or an inactive status.</p>
          </SettingsDisclosure>
          {inventory?.availability === "unavailable" ? (
            <div className="os-notice os-warning" role="status">
              <Info size={18} />
              <p>
                {groups[kind].title} could not be read with this login. Check View Setup and
                Configuration and access to this license inventory in Salesforce, then refresh.
                Other categories remain available.
              </p>
            </div>
          ) : (
            <>
              <div className="os-tools">
                <label className="os-search">
                  <Search size={16} />
                  <input
                    data-testid="org-settings-license-search"
                    aria-label="Search licenses"
                    placeholder="Search name or status…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <button
                  data-testid="org-settings-license-attention"
                  aria-pressed={attention}
                  className={attention ? "selected" : ""}
                  onClick={() => setAttention((v) => !v)}
                >
                  Needs attention <span>{needsAttention}</span>
                </button>
              </div>
              <div className="os-license-list">
                {filtered.map((license) => {
                  const expiry = licenseExpiry(license.expiresAt, checkedAt);
                  return (
                    <article className="os-license" key={license.id}>
                      <div className="os-license-identity">
                        <strong>{license.name}</strong>
                        <div className="os-license-tags">
                          <span className="os-tag">{license.status || "Status not reported"}</span>
                          {licenseNeedsAttention(license, checkedAt) && (
                            <span className="os-tag os-review-tag">Review</span>
                          )}
                        </div>
                        <p>
                          {license.expiresAt && Number.isFinite(Date.parse(license.expiresAt))
                            ? `${expiry?.expired ? "Expired" : "Expires"} ${date(license.expiresAt)}`
                            : kind === "user"
                              ? "Expiry not supplied for base user licenses"
                              : "Expiry not reported"}
                        </p>
                        <SettingsDisclosure id={`license-${license.id}`} title="License details">
                          {license.apiName && license.apiName !== license.name && (
                            <code>{license.apiName}</code>
                          )}
                          {license.usageUpdatedAt &&
                            Number.isFinite(Date.parse(license.usageUpdatedAt)) && (
                              <p>Counts updated {date(license.usageUpdatedAt)}</p>
                            )}
                          {license.monthlyLogins && (
                            <p className="os-login-note">
                              Login-based entitlement. Monthly usage and assigned users are separate
                              counts.
                            </p>
                          )}
                        </SettingsDisclosure>
                      </div>
                      <div>
                        <Capacity total={license.total} used={license.used} />
                        {license.monthlyLogins && (
                          <Capacity
                            total={license.monthlyLogins.total}
                            used={license.monthlyLogins.used}
                            monthly
                          />
                        )}
                      </div>
                    </article>
                  );
                })}
                {!filtered.length && (
                  <div className="os-empty">
                    {licenses.length
                      ? "No licenses match this filter."
                      : `No ${groups[kind].title.toLowerCase()} were reported.`}
                  </div>
                )}
              </div>
              {inventory?.capped && (
                <p className="os-small">
                  Showing the first 500 license records. This inventory is incomplete.
                </p>
              )}
            </>
          )}
          <SettingsDisclosure id="license-numbers" title="How to interpret these numbers">
            <ul>
              <li>
                Available is reported allowance minus assignments, with a minimum of zero. Status,
                expiry, compatible user licenses and permissions still determine whether access can
                be granted.
              </li>
              <li>
                User, feature and package licenses can cover the same people. Their counts are kept
                separate.
              </li>
              <li>
                Freezing a user keeps their user license assigned. Deactivation frees base user
                capacity, but package assignments can remain.
              </li>
              <li>
                Unused licenses do not reduce billing. Pricing, renewal dates and purchased products
                come from your contract.
              </li>
              <li>
                A missing numeric allowance can represent a package with org-wide access or an
                entitlement that does not report a seat cap. Verify the terms in Salesforce Setup.
              </li>
              <li>
                {read.data.monthlyLoginsAvailable
                  ? "Monthly login figures are shown where Salesforce reports a login-based entitlement."
                  : "Monthly login fields are unavailable to this login. Digital Experiences and View Setup and Configuration may be required."}{" "}
                Credits and other consumption entitlements require their own Salesforce usage
                reports.
              </li>
            </ul>
            <p>
              Check Company Information for user and permission set licenses, and Installed Packages
              for managed package entitlements.
            </p>
          </SettingsDisclosure>
        </>
      )}
    </ReadFrame>
  );
}
