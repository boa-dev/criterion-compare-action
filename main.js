const { Toolkit } = require('actions-toolkit')
const tools = new Toolkit({
  event: ['pull_request.opened', 'pull_request.synchronize']
});

async function main() {
  await tools.runInWorkspace('cargo', ['bench', '--', '--save-baseline', 'changes']);
  await tools.runInWorkspace('git', ['checkout', 'master']);
  await tools.runInWorkspace('cargo', ['bench', '--', '--save-baseline', 'master']);
  let result = await tools.runInWorkspace('critcmp', ['master', 'changes']);
  console.log(result.stdout);
}

// IIFE to be able to use async/await
(async () => {
  try {
    await main();
  } catch (e) {
    tools.exit.failure(`Unhanded error:\n${e}`)
  }
})();
