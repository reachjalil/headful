/* oxlint-disable shadcn/no-unknown-classes -- Org settings owns its scoped surface. */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Info, RefreshCw } from "lucide-react";
import type { HeadfulInput, HeadfulOperation, HeadfulResult } from "@t3tools/contracts/headful";
import type { SetupDispatch } from "../setup-service";
import { SettingsDisclosure } from "./SettingsDisclosure";
export const ReadBusy = createContext<(change: number) => void>(() => {});

export function useRead<K extends HeadfulOperation>(
  dispatch: SetupDispatch,
  operation: K,
  input: HeadfulInput<K>,
) {
  const reportBusy = useContext(ReadBusy);
  const [revision, setRevision] = useState(0);
  const serialized = JSON.stringify(input);
  const readKey = `${operation}:${serialized}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    data: HeadfulResult<K> | null;
    loading: boolean;
    error: string;
  }>({ key: readKey, data: null, loading: true, error: "" });
  useEffect(() => {
    let active = true;
    let pending = true;
    reportBusy(1);
    const finished = () => {
      if (pending) {
        pending = false;
        reportBusy(-1);
      }
    };
    void dispatch(operation, JSON.parse(serialized) as HeadfulInput<K>).then(
      (data) => {
        finished();
        if (active) setState({ key: readKey, data, loading: false, error: "" });
      },
      () => {
        finished();
        if (active)
          setState({
            key: readKey,
            data: null,
            loading: false,
            error:
              "This information is unavailable. Check the selected login’s Salesforce permissions or reconnect it in Connections & CLI, then refresh.",
          });
      },
    );
    return () => {
      active = false;
      finished();
    };
  }, [dispatch, operation, serialized, readKey, reportBusy]);
  const visible = state.key === readKey ? state : { data: null, loading: true, error: "" };
  return { ...visible, refresh: () => setRevision((v) => v + 1) };
}

export function ReadFrame({
  title,
  description,
  read,
  source,
  children,
}: {
  title: string;
  description: string;
  source: string;
  read: {
    loading: boolean;
    error: string;
    refresh: () => void;
    data: { checkedAt: string } | null;
  };
  children: ReactNode;
}) {
  return (
    <>
      <div className="os-page-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          className="os-refresh"
          disabled={read.loading}
          onClick={read.refresh}
          aria-label={`Refresh ${title}`}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      {read.loading ? (
        <div className="os-empty" role="status">
          Reading {title.toLowerCase()} from Salesforce…
        </div>
      ) : read.error ? (
        <div className="os-notice os-warning" role="alert">
          <Info size={18} />
          <p>{read.error}</p>
        </div>
      ) : (
        children
      )}
      {read.data && (
        <div className="os-source">
          <SettingsDisclosure
            id="data-source"
            title="Data source"
            hint={`Checked ${new Date(read.data.checkedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}`}
          >
            <p>{source} · Refresh to check again</p>
          </SettingsDisclosure>
        </div>
      )}
    </>
  );
}
