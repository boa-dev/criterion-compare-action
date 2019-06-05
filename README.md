<h3 align="center">criterion-compare</h3>
<p align="center">Compare the performance of a PR against master</p>

---

> ⚠️ Performance benchmarks provided by this action may fluctuate as load on GitHub Actions does. Run benchmarks locally before making any decisions based on the results.

A GitHub action that will compare the benchmark output between a PR and master, using the project's [criterion.rs](https://github.com/bheisler/criterion.rs/) benchmarks.

## Example
![Example benchmark comparison comment](image.png)

## Usage

Create a `.github/main.workflow` file in your repo:

```hcl
# .github/main.workflow

workflow "benchmark pull requests" {
  on = "pull_request"
  resolves = ["run benchmark"]
}

action "run benchmark" {
  uses = "matchai/criterion-compare-action@master"
  secrets = ["GITHUB_TOKEN"]
}

```
