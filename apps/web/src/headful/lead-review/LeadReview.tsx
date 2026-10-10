/* oxlint-disable shadcn/no-unknown-classes -- Focused Headful surface uses the scoped setup stylesheet. */
import { useCallback, useEffect, useState } from "react";
import type { HeadfulResult } from "@t3tools/contracts/headful";
import { setupDispatch, type SetupDispatch } from "../setup-service";
import "../salesforce-setup.css";
import "./lead-review.css";

type Lead = HeadfulResult<"listLeads">["leads"][number];

/** Read-only lead review for one explicitly selected, agent-enabled org. No provider writes. */
export function LeadReview({
  dispatch = setupDispatch,
  banner,
  onStepChange,
}: {
  dispatch?: SetupDispatch;
  banner?: React.ReactNode;
  onStepChange?: ((step: string) => void) | undefined;
}) {
  const [orgs, setOrgs] = useState<HeadfulResult<"orgs.list">["orgs"]>([]);
  const [orgId, setOrgId] = useState("");
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [detail, setDetail] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const step = detail ? "detail" : "list";
  useEffect(() => onStepChange?.(step), [step, onStepChange]);

  const load = useCallback(
    async (target: string) => {
      setBusy(true);
      setError("");
      setDetail(null);
      try {
        setLeads(
          (await dispatch("listLeads", { orgId: target, search: "", limit: 25, page: 1 })).leads,
        );
      } catch {
        setLeads(null);
        setError("Headful could not read leads from this org. Check its connection in Setup.");
      } finally {
        setBusy(false);
      }
    },
    [dispatch],
  );
  useEffect(() => {
    void (async () => {
      const saved = (await dispatch("orgs.list", {})).orgs.filter((org) => org.agentEnabled);
      setOrgs(saved);
      const first = saved[0]?.id ?? "";
      setOrgId(first);
      if (first) await load(first);
      else setBusy(false);
    })();
  }, [dispatch, load]);
  const open = async (lead: Lead) => {
    setBusy(true);
    try {
      setDetail((await dispatch("inspectLead", { orgId, leadId: lead.id })).lead);
    } catch {
      setError("Headful could not read this lead. Check the org's connection in Setup.");
    } finally {
      setBusy(false);
    }
  };
  const org = orgs.find((candidate) => candidate.id === orgId);
  return (
    <main
      className="sf-app lr-app"
      data-experience="lead-review"
      data-experience-step={step}
      aria-busy={busy}
    >
      {banner}
      <div className="lr-layout">
        <header className="lr-header">
          <div>
            <div className="sf-eyebrow">LEADS · READ ONLY</div>
            <h1>{detail ? detail.name : "Review leads"}</h1>
            {org && (
              <p>
                Reading {org.label} as {org.username}
              </p>
            )}
          </div>
          {orgs.length > 1 && (
            <select
              aria-label="Org"
              data-testid="lead-org"
              value={orgId}
              onChange={(event) => {
                setOrgId(event.target.value);
                void load(event.target.value);
              }}
            >
              {orgs.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
          )}
        </header>
        {error && (
          <p className="sf-error" role="alert">
            {error}
          </p>
        )}
        {!busy && !orgs.length && (
          <p className="lr-empty">Enable an org in Setup to review its leads.</p>
        )}
        {detail ? (
          <section className="lr-detail" aria-label="Lead detail">
            <dl>
              {(
                [
                  ["Title", detail.title],
                  ["Company", detail.company],
                  ["Status", detail.status],
                  ["Rating", detail.rating],
                  ["Email", detail.email],
                  ["Source", detail.source],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value ?? "—"}</dd>
                </div>
              ))}
            </dl>
            <button
              className="sf-secondary"
              data-testid="lead-back"
              onClick={() => setDetail(null)}
            >
              ← All leads
            </button>
          </section>
        ) : (
          leads &&
          (leads.length ? (
            <table className="lr-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, index) => (
                  <tr key={lead.id}>
                    <td>
                      <button data-testid={`lead-row-${index + 1}`} onClick={() => void open(lead)}>
                        {lead.name}
                      </button>
                    </td>
                    <td>{lead.company}</td>
                    <td>{lead.status}</td>
                    <td>{lead.rating ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="lr-empty">No leads in {org?.label ?? "this org"}.</p>
          ))
        )}
      </div>
    </main>
  );
}
