import { useEffect, useState } from "react";
import { headfulUtilityResultSchemas } from "@t3tools/contracts/headful-utilities";
import type { z } from "zod";
import { useUtilityTask } from "./primitives";
import type { UtilityComponentProps } from "./types";

type Objects = z.infer<(typeof headfulUtilityResultSchemas)["utilities.objects.list"]>;
export type Describe = z.infer<(typeof headfulUtilityResultSchemas)["utilities.objects.describe"]>;
const empty: Objects["objects"] = [];

export function useObjects({ orgId, dispatch }: Pick<UtilityComponentProps, "orgId" | "dispatch">) {
  const [state, setState] = useState<{
    orgId: string;
    dispatch: UtilityComponentProps["dispatch"];
    data: Objects;
  } | null>(null);
  const { run, reset, busy, error } = useUtilityTask();
  useEffect(() => {
    reset();
    if (orgId)
      void run(
        async () =>
          headfulUtilityResultSchemas["utilities.objects.list"].parse(
            await dispatch("utilities.objects.list", { orgId, category: "all" }),
          ),
        (data) => setState({ orgId, dispatch, data }),
      );
    return reset;
  }, [orgId, dispatch, run, reset]);
  const data = state?.orgId === orgId && state.dispatch === dispatch ? state.data : null;
  return { objects: data?.objects ?? empty, busy, error };
}
