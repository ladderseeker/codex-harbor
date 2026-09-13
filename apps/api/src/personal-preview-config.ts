import { z } from "zod";
export const personalPreviewEntry = z
  .object({
    name: z.string().min(1).max(60),
    port: z.number().int().min(1024).max(65535),
    origin: z.url().refine((value) => {
      const u = new URL(value);
      return (
        u.protocol === "https:" &&
        u.origin === value &&
        !u.username &&
        !u.password
      );
    }, "Canonical HTTPS preview origin required"),
  })
  .strict();
export function personalPreviewConfig(
  raw: string,
  ownerOrigin: string,
  reservedPorts: number[],
) {
  const entries = z.array(personalPreviewEntry).max(8).parse(JSON.parse(raw));
  const ports = new Set<number>(),
    hosts = new Set<string>();
  for (const entry of entries) {
    const host = new URL(entry.origin).hostname;
    if (
      host === new URL(ownerOrigin).hostname ||
      reservedPorts.includes(entry.port) ||
      ports.has(entry.port) ||
      hosts.has(host)
    )
      throw Error(
        "Personal previews require unique origins and ports separate from Harbor services",
      );
    ports.add(entry.port);
    hosts.add(host);
  }
  return entries;
}
export type PersonalPreviewEntry = z.infer<typeof personalPreviewEntry>;
