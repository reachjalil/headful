/** Native-only T3 service port. Models and remote clients never receive this
 * configuration API, provider credentials or arbitrary T3 thread identities. */
export interface HeadfulAgentBoundary {
  threadId: string;
  ownerModId: string;
  projectId: string;
  providerInstanceId: string;
  model: string;
  expiresAt: number;
  workspace: string;
  mcp: { endpoint: string; authorization: string; tools: string[] };
  revokedAt: number | null;
}
export interface HeadfulAgentRunnerPort {
  options(): Promise<{
    projects: { id: string; name: string }[];
    providers: {
      instanceId: string;
      driver: string;
      models: string[];
      boundedExecution: boolean;
    }[];
  }>;
  launch(input: {
    threadId: string;
    commandId: string;
    projectId: string;
    providerInstanceId: string;
    model: string;
    title: string;
    instructions: string;
    expiresAt: number;
    mcp: HeadfulAgentBoundary["mcp"];
  }): Promise<unknown>;
  read(
    threadId: string,
  ): Promise<{
    threadId: string;
    status: string;
    nativeRunId: string | null;
    activity: { id: string; role: string; text: string; streaming: boolean }[];
    observedAt: string;
  }>;
  message(input: {
    threadId: string;
    commandId: string;
    instructions: string;
  }): Promise<{ delivery: string; nativeRunId: string }>;
  interrupt(input: { threadId: string; commandId: string }): Promise<{ outcome: string }>;
  receipt(input: {
    threadId: string;
    commandId: string;
  }): Promise<{ status: "accepted" | "rejected" | "unavailable"; sequence?: number }>;
  revoke(threadId: string): Promise<void>;
}

export interface HeadfulAgentRunnerFactory {
  forMod(modId: string): HeadfulAgentRunnerPort;
}
