const workersDevUrlPattern =
  /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+workers\.dev$/;

export function workersDevUrl(targets) {
  if (!Array.isArray(targets)) return undefined;
  return targets.find(
    (target) => typeof target === "string" && workersDevUrlPattern.test(target),
  );
}

export function workersDevUrlFromOutput(text) {
  let found;
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (entry?.type === "deploy") found = workersDevUrl(entry.targets);
  }
  if (!found) throw new Error("Deployment did not report a workers.dev URL.");
  return found;
}

export async function checkHealth(base) {
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.endsWith(".workers.dev")
  ) {
    throw new Error("Deployment did not report a workers.dev URL.");
  }
  url.pathname = "/healthz";
  url.search = "";
  url.hash = "";
  console.log(`Checking ${url.href}`);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (
        response.status === 200 &&
        JSON.stringify(await response.json()) === "{}"
      ) {
        console.log("Health check passed.");
        return;
      }
    } catch {
      /* Retry while the deployment propagates. */
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Deployment health check failed.");
}
