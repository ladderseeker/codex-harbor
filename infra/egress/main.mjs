import { createProxy } from "./proxy.mjs";
import { bindAddress } from "./bind.mjs";
import { createResolver } from "./resolver.mjs";
const proxy = createProxy({
  lookup: createResolver(process.env.HARBOR_EGRESS_DNS_PROFILE ?? "system"),
});
proxy.server.on("error", () => {
  process.stderr.write("egress unavailable\n");
  process.exitCode = 1;
  void proxy.close();
});
proxy.server.listen(3128, bindAddress(), () =>
  process.stdout.write("egress ready\n"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void proxy.close();
  });
