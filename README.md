<h3 align="center">criterion-compare</h3>
<p align="center">Compare the performance of a PR against master</p>

---

> ⚠️ Performance benchmarks provided by this action may fluctuate as load on GitHub Actions does. Run benchmarks locally before making any decisions based on the results.

A GitHub action that will compare the benchmark output between a PR and master, using the project's [criterion.rs](https://github.com/bheisler/criterion.rs/) benchmarks.

## Example

![Example benchmark comparison comment](image.png)

## Usage

Create a `.github/workflows/pull_request.yml` file in your repo:

```yml
on: [pull_request]
name: benchmark pull requests
jobs:
  runBenchmark:
    name: run benchmark
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@master
      - uses: actions-rs/toolchain@v1
      - uses: jasonwilliams/criterion-compare-action@move_to_actions
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
