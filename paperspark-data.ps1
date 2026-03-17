$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliPath = Join-Path $scriptDir 'scripts\paperspark-data-cli.mjs'

node $cliPath @Args
exit $LASTEXITCODE
