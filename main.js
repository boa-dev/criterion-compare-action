const exec = require("@actions/exec");
const core = require("@actions/core");
const github = require("@actions/github");

const context = github.context;

async function main() {
  const myToken = core.getInput("token", { required: true });
  const options = {};
  let myOutput;
  let myError;
  let cwd;

  if ((cwd = core.getInput("cwd"))) {
    options.cwd = cwd;
  }
  
  benchCmd = ["bench"];
  if ((cargoBenchName = core.getInput("benchName"))) {
    benchCmd = benchCmd.concat(["--bench", cargoBenchName]);
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
  await exec.exec("git", ["checkout", "master"]);
  core.debug("Checked out to master branch");
  await exec.exec(
    "cargo",
    benchCmd.concat(["--", "--save-baseline", "master"]),
    options
  );
  core.debug("Master benchmarked");

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
  const octokit = github.getOctokit(myToken);

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

function isSignificant(changesDur, changesErr, masterDur, masterErr) {
  if (changesDur < masterDur) {
    return changesDur + changesErr < masterDur || masterDur - masterErr > changesDur;
  } else {
    return changesDur - changesErr > masterDur || masterDur + masterErr < changesDur;
  }
}

function convertToMarkdown(results) {
  /* Example results:
    group                            changes                                master
    -----                            -------                                ------
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
        changesFactor,
        changesDuration,
        _changesBandwidth,
        masterFactor,
        masterDuration,
        _masterBandwidth,
      ]) => {
        let masterUndefined = typeof masterDuration === "undefined";
        let changesUndefined = typeof changesDuration === "undefined";

        if (!name || (masterUndefined && changesUndefined)) {
          return "";
        }

        let difference = "N/A";
        if (!masterUndefined && !changesUndefined) {
          changesFactor = Number(changesFactor);
          masterFactor = Number(masterFactor);

          let changesDurSplit = changesDuration.split('±');
          let changesUnits = changesDurSplit[1].slice(-2);
          let changesDurSecs = convertDurToSeconds(changesDurSplit[0], changesUnits);
          let changesErrorSecs = convertDurToSeconds(changesDurSplit[1].slice(0, -2), changesUnits);

          let masterDurSplit = masterDuration.split('±');
          let masterUnits = masterDurSplit[1].slice(-2);
          let masterDurSecs = convertDurToSeconds(masterDurSplit[0], masterUnits);
          let masterErrorSecs = convertDurToSeconds(masterDurSplit[1].slice(0, -2), masterUnits);

          difference = -(1 - changesDurSecs / masterDurSecs) * 100;
          difference = (changesDurSecs <= masterDurSecs ? "" : "+") + difference.toFixed(2) + "%";
          if (isSignificant(changesDurSecs, changesErrorSecs, masterDurSecs, masterErrorSecs)) {
            if (changesDurSecs < masterDurSecs) {
              changesDuration = `**${changesDuration}**`;
            } else if (changesDurSecs > masterDurSecs) {
              masterDuration = `**${masterDuration}**`;
            }

            difference = `**${difference}**`;
          }
        }

        if (masterUndefined) {
          masterDuration = "N/A";
        }

        if (changesUndefined) {
          changesDuration = "N/A";
        }

        return `| ${name} | ${changesDuration} | ${masterDuration} | ${difference} |`;
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
