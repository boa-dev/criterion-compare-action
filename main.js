const exec = require("@actions/exec");
const core = require("@actions/core");
const github = require("@actions/github");

const context = github.context;

async function main() {
  const myToken = process.env["GITHUB_TOKEN"];

  core.debug("### Install Critcmp ###");
  await exec.exec("cargo", ["install", "critcmp"]);

  core.debug("### Benchmark starting ###");
  await exec.exec("cargo", [
    "bench",
    "-p",
    "Boa",
    "--",
    "--save-baseline",
    "changes"
  ]);
  core.debug("Changes benchmarked");
  await exec.exec("git", ["checkout", "master"]);
  core.debug("Checked out to master branch");
  await exec.exec("cargo", [
    "bench",
    "-p",
    "Boa",
    "--",
    "--save-baseline",
    "master"
  ]);
  core.debug("Master benchmarked");
  // PWD - /home/runner/work/boa/boa
  await exec.exec("pwd");
  await exec.exec("ls", ["-lah"]);
  await exec.exec("ls", ["-lah", "./boa/target"]);
  await exec.exec("ls", ["-lah", "./boa/target/criterion"]);
  await exec.exec("ls", ["-lah", "./target"]);
  await exec.exec("ls", [
    "-lah",
    "/home/runner/work/boa/boa/boa/target/criterion"
  ]);

  const options = {};
  let myOutput;
  let myError;

  options.listeners = {
    stdout: data => {
      myOutput += data.toString();
    },
    stderr: data => {
      myError += data.toString();
    },
    cwd: "boa"
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
      body: resultsAsMarkdown
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

        return {
          name,
          changesDuration,
          masterDuration,
          difference
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
