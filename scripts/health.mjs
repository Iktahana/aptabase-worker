const url = new URL(process.env.WORKER_URL);
if (url.protocol !== "https:" || url.username || url.password)
  throw new Error("WORKER_URL must be a public HTTPS base URL.");
url.pathname = "/healthz";
url.search = "";
url.hash = "";
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
      process.exit(0);
    }
  } catch {
    /* Retry while the deployment propagates. */
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
throw new Error("Deployment health check failed.");
