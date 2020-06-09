const exec = require("@actions/exec");
const core = require("@actions/core");
const github = require("@actions/github");

const context = github.context;

async function main() {
  const myToken = core.getInput("token", { required: true });
  const options = {};
  if ((cwd = core.getInput("cwd"))) {
    options.cwd = cwd;
  }

  core.debug("### Install Critcmp ###");
  await exec.exec("cargo", ["install", "critcmp"]);

  core.debug("### Benchmark starting ###");
  await exec.exec(
    "cargo",
    ["bench", "--", "--save-baseline", "changes"],
    options
  );
  core.debug("Changes benchmarked");
  await exec.exec("git", ["checkout", "master"]);
  core.debug("Checked out to master branch");
  await exec.exec(
    "cargo",
    ["bench", "--", "--save-baseline", "master"],
    options
  );
  core.debug("Master benchmarked");

  let myOutput;
  let myError;
  let cwd;

  options.listeners = {
    stdout: (data) => {
      myOutput += data.toString();
    },
    stderr: (data) => {
      myError += data.toString();
    },
  };

  await exec.exec("critcmp", ["master", "changes"], options);
  const resultsAsMarkdown = convertToMarkdown(myOutput);

  // An authenticated instance of `@octokit/rest`
  const octokit = new github.GitHub(myToken);

  const contextObj = { ...context.issue };

  try {
    await octokit.issues.createComment({
      owner: contextObj.owner,
      repo: contextObj.repo,
      issue_number: contextObj.number,
      body: resultsAsMarkdown,
    });
  } catch (e) {
    // If we can't post to the comment, display results here.
    // forkedRepos only have READ ONLY access on GITHUB_TOKEN
    // https://github.community/t5/GitHub-Actions/quot-Resource-not-accessible-by-integration-quot-for-adding-a/td-p/33925
    const resultsAsObject = convertToTableObject(myOutput);
    console.table(resultsAsObject);

    core.debug(e);
    core.debug("Failed to comment");
  }

  core.debug("Succesfully run!");
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
    .map((row) => row.split(/\s{2,}/)) // split if 2+ spaces together
    .map(
      ([
        name,
        changesFactor,
        changesDuration,
        _changesBandwidth,
        masterFactor,
        masterDuration,
        _masterBandwidth,
      ]) => {
        changesFactor = Number(changesFactor);
        masterFactor = Number(masterFactor);

        let difference =
          (changesFactor <= masterFactor ? "" : "+") +
          (changesFactor - masterFactor) * 100;
        if (changesFactor < masterFactor) {
          changesDuration = `**${changesDuration}**`;
        } else if (changesFactor > masterFactor) {
          masterDuration = `**${masterDuration}**`;
        }

        return `| ${name} | ${changesDuration} | ${masterDuration} | ${difference}% |`;
      }
    )
    .join("\n");

  let shortSha = context.sha.slice(0, 7);
  return `## Benchmark for ${shortSha}
  <details>
    <summary>Click to view benchmark</summary>

| Test | PR Benchmark | Master Benchmark | % |
|------|--------------|------------------|---|
${benchResults}

  </details>
  `;
}

function convertToTableObject(results) {
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
    .map((row) => row.split(/\s{2,}/)) // split if 2+ spaces together
    .map(
      ([
        name,
        changesFactor,
        changesDuration,
        _changesBandwidth,
        masterFactor,
        masterDuration,
        _masterBandwidth,
      ]) => {
        changesFactor = Number(changesFactor);
        masterFactor = Number(masterFactor);

        let difference = -(1 - changesFactor / masterFactor) * 100;
        difference =
          (changesFactor <= masterFactor ? "" : "+") +
          difference.toPrecision(2);
        if (changesFactor < masterFactor) {
          changesDuration = `**${changesDuration}**`;
        } else if (changesFactor > masterFactor) {
          masterDuration = `**${masterDuration}**`;
        }

        return {
          name,
          changesDuration,
          masterDuration,
          difference,
        };
      }
    );

  return benchResults;
}

// IIFE to be able to use async/await
(async () => {
  try {
    await main();
  } catch (e) {
    console.log(e.stack);
    core.setFailed(`Unhanded error:\n${e}`);
  }
})();
