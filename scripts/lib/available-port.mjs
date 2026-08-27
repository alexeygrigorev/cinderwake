import net from "node:net";

export async function availablePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  if (!address || typeof address === "string") {
    probe.close();
    throw new Error("Could not determine an available capture port");
  }
  const port = address.port;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
