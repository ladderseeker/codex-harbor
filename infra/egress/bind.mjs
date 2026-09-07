import { networkInterfaces } from "node:os";
import ipaddr from "ipaddr.js";
export function bindAddress() {
  const cidr = process.env.HARBOR_EGRESS_INTERNAL_SUBNET;
  if (!cidr || !/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(cidr))
    throw Error("Invalid internal network");
  const range = ipaddr.parseCIDR(cidr);
  const matches = Object.values(networkInterfaces())
    .flat()
    .filter(
      (n) =>
        n &&
        n.family === "IPv4" &&
        !n.internal &&
        ipaddr.parse(n.address).match(range),
    );
  if (matches.length !== 1) throw Error("Internal interface unavailable");
  return matches[0].address;
}
