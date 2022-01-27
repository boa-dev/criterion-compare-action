const exec = require("@actions/exec");
const core = require("@actions/core");
const github = require("@actions/github");

const context = github.context;

async function main() {
  const inputs = {
    token: core.getInput("token", { required: true }),
    branchName: core.getInput("branchName", { required: true }),
    cwd: core.getInput("cwd"),
    benchName: core.getInput("benchName"),
  };
  core.debug(`Inputs: ${inspect(inputs)}`);

  const options = {};
  let myOutput = "";
  let myError = "";
  if (inputs.cwd) {
    options.cwd = inputs.cwd;
  }

  let benchCmd = ["bench"];
  if (inputs.benchName) {
    benchCmd = benchCmd.concat(["--bench", inputs.benchName]);
  }

  core.debug("### Install Critcmp ###");
  await exec.exec("cargo", ["install", "critcmp"]);

  core.debug("### Benchmark starting ###");
  await exec.exec(
    "cargo",
    benchCmd.concat(["--", "--save-baseline", "changes"]),
    options
  );
  core.debug("Changes benchmarked");
  await exec.exec("git", [
    "checkout",
    core.getInput("branchName") || github.base_ref,
  ]);
  core.debug("Checked out to base branch");
  await exec.exec(
    "cargo",
    benchCmd.concat(["--", "--save-baseline", "base"]),
    options
  );
  core.debug("Base benchmarked");

  options.listeners = {
    stdout: (data) => {
      myOutput += data.toString();
    },
    stderr: (data) => {
      myError += data.toString();
    },
  };

  await exec.exec("critcmp", ["base", "changes"], options);

  core.setOutput("stdout", myOutput);
  core.setOutput("stderr", myError);

  const resultsAsMarkdown = convertToMarkdown(myOutput);

  // An authenticated instance of `@octokit/rest`
  const octokit = github.getOctokit(inputs.token);

  const contextObj = { ...context.issue };
  core.debug(`Context: ${inspect(contextObj)}`);

  try {
    const { data: comment } = await octokit.rest.issues.createComment({
      owner: contextObj.owner,
      repo: contextObj.repo,
      issue_number: contextObj.number,
      body: resultsAsMarkdown,
    });
    core.info(
      `Created comment id '${comment.id}' on issue '${inputs.issueNumber}'.`
    );
    core.setOutput("comment-id", comment.id);
  } catch (err) {
    core.warning(`Failed to comment: ${err}`);

    // If we can't post to the comment, display results here.
    // forkedRepos only have READ ONLY access on GITHUB_TOKEN
    // https://github.community/t5/GitHub-Actions/quot-Resource-not-accessible-by-integration-quot-for-adding-a/td-p/33925
    const resultsAsObject = convertToTableObject(myOutput);
    console.table(resultsAsObject);
  }

  core.debug("Succesfully run!");
}

function convertDurToSeconds(dur, units) {
  let seconds;
  switch (units) {
    case "s":
      seconds = dur;
      break;
    case "ms":
      seconds = dur / 1000;
      break;
    case "µs":
      seconds = dur / 1000000;
      break;
    case "ns":
      seconds = dur / 1000000000;
      break;
    default:
      seconds = dur;
      break;
  }

  return seconds;
}

function isSignificant(changesDur, changesErr, baseDur, baseErr) {
  if (changesDur < baseDur) {
    return changesDur + changesErr < baseDur || baseDur - baseErr > changesDur;
  } else {
    return changesDur - changesErr > baseDur || baseDur + baseErr < changesDur;
  }
}

function convertToMarkdown(results) {
  /* Example results:
    group                            base                                   changes
    -----                            ----                                   -------
    character module                 1.03     22.2±0.41ms        ? B/sec    1.00     21.6±0.53ms        ? B/sec
    directory module – home dir      1.02     21.7±0.69ms        ? B/sec    1.00     21.4±0.44ms        ? B/sec
    full prompt                      1.08     46.0±0.90ms        ? B/sec    1.00     42.7±0.79ms        ? B/sec
  */

  let resultLines = results.trimRight().split("\n");
  let benchResults = resultLines
    .slice(2) // skip headers
    .map((row) => row.split(/\s{2,}/)) // split if 2+ spaces together
    .map(
      ([
        name,
        baseFactor,
        baseDuration,
        _baseBandwidth,
        changesFactor,
        changesDuration,
        _changesBandwidth,
      ]) => {
        let baseUndefined = typeof baseDuration === "undefined";
        let changesUndefined = typeof changesDuration === "undefined";

        if (!name || (baseUndefined && changesUndefined)) {
          return "";
        }

        let difference = "N/A";
        if (!baseUndefined && !changesUndefined) {
          changesFactor = Number(changesFactor);
          baseFactor = Number(baseFactor);

          let changesDurSplit = changesDuration.split("±");
          let changesUnits = changesDurSplit[1].slice(-2);
          let changesDurSecs = convertDurToSeconds(
            changesDurSplit[0],
            changesUnits
          );
          let changesErrorSecs = convertDurToSeconds(
            changesDurSplit[1].slice(0, -2),
            changesUnits
          );

          let baseDurSplit = baseDuration.split("±");
          let baseUnits = baseDurSplit[1].slice(-2);
          let baseDurSecs = convertDurToSeconds(baseDurSplit[0], baseUnits);
          let baseErrorSecs = convertDurToSeconds(
            baseDurSplit[1].slice(0, -2),
            baseUnits
          );

          difference = -(1 - changesDurSecs / baseDurSecs) * 100;
          difference =
            (changesDurSecs <= baseDurSecs ? "" : "+") +
            difference.toFixed(2) +
            "%";
          if (
            isSignificant(
              changesDurSecs,
              changesErrorSecs,
              baseDurSecs,
              baseErrorSecs
            )
          ) {
            if (changesDurSecs < baseDurSecs) {
              changesDuration = `**${changesDuration}**`;
            } else if (changesDurSecs > baseDurSecs) {
              baseDuration = `**${baseDuration}**`;
            }

            difference = `**${difference}**`;
          }
        }

        if (baseUndefined) {
          baseDuration = "N/A";
        }

        if (changesUndefined) {
          changesDuration = "N/A";
        }

        return `| ${name} | ${baseDuration} | ${changesDuration} | ${difference} |`;
      }
    )
    .join("\n");

  let shortSha = context.sha.slice(0, 7);
  return `## Benchmark for ${shortSha}
  <details>
    <summary>Click to view benchmark</summary>
| Test | Base         | PR               | % |
|------|--------------|------------------|---|
${benchResults}

  </details>
  `;
}

function convertToTableObject(results) {
  /* Example results:
    group                            base                                   changes
    -----                            ----                                   -------
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
        baseFactor,
        baseDuration,
        _baseBandwidth,
        changesFactor,
        changesDuration,
        _changesBandwidth,
      ]) => {
        changesFactor = Number(changesFactor);
        baseFactor = Number(baseFactor);

        let difference = -(1 - changesFactor / baseFactor) * 100;
        difference =
          (changesFactor <= baseFactor ? "" : "+") + difference.toPrecision(2);
        if (changesFactor < baseFactor) {
          changesDuration = `**${changesDuration}**`;
        } else if (changesFactor > baseFactor) {
          baseDuration = `**${baseDuration}**`;
        }

        return {
          name,
          baseDuration,
          changesDuration,
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
