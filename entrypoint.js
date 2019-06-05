const { Toolkit } = require("actions-toolkit");
const tools = new Toolkit({
  event: ["pull_request.opened", "pull_request.synchronize"]
});

async function main() {
  tools.log("### Benchmark starting ###");
  await tools.runInWorkspace("cargo", [
    "bench",
    "--",
    "--save-baseline",
    "changes"
  ]);
  tools.log("Changes benchmarked");
  await tools.runInWorkspace("git", ["checkout", "master"]);
  tools.log("Checked out to master branch");
  await tools.runInWorkspace("cargo", [
    "bench",
    "--",
    "--save-baseline",
    "master"
  ]);
  tools.log("Master benchmarked");
  const result = await tools.runInWorkspace("critcmp", ["master", "changes"]);
  const resultsAsMarkdown = convertToMarkdown(result.stdout);

  // An authenticated instance of `@octokit/rest`
  const octokit = tools.github;

  await octokit.repos.createCommitComment({
    ...tools.context.repo,
    sha: tools.context.sha,
    body: resultsAsMarkdown
  });

  tools.exit.success("Succesfully run!");
}

function convertToMarkdown(results) {
  /* Example results: 
    group                            changes                                master
    -----                            -------                                ------
    character module                 1.03     22.2±0.41ms        ? B/sec    1.00     21.6±0.53ms        ? B/sec
    directory module – home dir      1.02     21.7±0.69ms        ? B/sec    1.00     21.4±0.44ms        ? B/sec
    full prompt                      1.08     46.0±0.90ms        ? B/sec    1.00     42.7±0.79ms        ? B/sec
  */

  let resultLines = results.split("\n");
  let benchResults = resultLines
    .slice(2) // skip headers
    .map(row => row.split(/\s{2,}/)) // split if 2+ spaces together
    .map(
      ([
        name,
        changesFactor,
        changesDuration,
        _changesBandwidth,
        masterFactor,
        masterDuration,
        _masterBandwidth
      ]) => {
        changesFactor = Number(changesFactor);
        masterFactor = Number(masterFactor);

        let difference = 100;
        if (changesFactor < masterFactor) {
          changesDuration = `**${changesDuration}**`;
          difference = (2 - masterFactor) * 100;
        } else if (changesFactor > masterFactor) {
          masterDuration = `**${masterDuration}**`;
          difference = changesFactor * 100;
        }

        return `| ${name} | ${changesDuration} | ${masterDuration} | ${difference}% |`;
      }
    )
    .join("\n");

  let shortSha = tools.context.sha.slice(0,7);
  return `## Benchmark for ${shortSha}
  <details>
    <summary>Click to view benchmark</summary>

| Test | PR Benchmark | Master Benchmark | % |
|------|--------------|------------------|---|
${benchResults}

  </details>
  `;
}

// IIFE to be able to use async/await
(async () => {
  try {
    await main();
  } catch (e) {
    tools.exit.failure(`Unhanded error:\n${e}`);
  }
})();
