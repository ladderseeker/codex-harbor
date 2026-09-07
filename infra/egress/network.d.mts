export type EgressIdentity = { instanceId?: string; projectId: string; sessionId: string; generation: number };
export const EGRESS_IMAGE: string;
export function provisionEgress(config: EgressIdentity): Promise<{ networkName: string; outboundName: string; proxyName: string; proxyUrl: string; modelBaseUrl: string; cleanup(): Promise<void> }>;
export function revokeEgress(config: EgressIdentity): Promise<void>;
