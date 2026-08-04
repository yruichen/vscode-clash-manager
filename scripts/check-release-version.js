'use strict';

const packageJson = require('../package.json');

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error('Release workflow requires a semantic version tag such as v0.1.0');
}

if (tag !== `v${packageJson.version}`) {
  throw new Error(`Tag ${tag} does not match package version ${packageJson.version}`);
}

process.stdout.write(`Release tag ${tag} matches package version.\n`);
