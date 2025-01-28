import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import { option } from 'yargs';
import { logger, utils } from './utils';

type ReleaseType = 'major' | 'minor' | 'patch';

export class ReleaseCreator {
    private logger: logger;

    constructor(
        private options: {
            branch: string;
            releaseVersion: string;
        }
    ) {
    }

    async run() {
        console.log('Creating release PR');
        console.log(`Branch: ${this.options.branch}`);
        console.log(`Version: ${this.options.releaseVersion}`);
        // execSync(`git checkout -b release/${this.options.version} ${this.options.branch}`);
        // execSync(`git push origin release/${this.options.version}`);
        // execSync(`hub pull-request -b ${this.options.branch} -h release/${this.options.version} -m "Release ${this.options.version}"`);
    }

    async stageRelease(options: { releaseType: ReleaseType, branch: string }) {
        logger.log('Staging release...');
        logger.increaseIndent();

        logger.log(`Checking for a clean repository`);
        if (!utils.executeCommandSucceeds('git diff --quiet')) {
            throw new Error('Repository is not clean');
        }

        logger.log(`Checkout branch ${options.branch}`);
        if (!utils.executeCommandSucceeds(`git checkout ${options.branch}`)) {
            throw new Error(`Branch ${options.branch} does not exist`);
        }

        logger.log(`Get the incremented release version`);
        const releaseVersion = await this.incrementedVersion(options.releaseType);

        logger.log(`Create new release branch release/${releaseVersion}`);
        if (!utils.executeCommandSucceeds(`git checkout -b release/${releaseVersion}`)) {
            throw new Error(`Cannot create release branch release/${releaseVersion}`);
        }


        // create commit
        // create pull request
        // create github release
        logger.decreaseIndent();
    }

    private async incrementedVersion(releaseType: ReleaseType) {
        const packageJson = await fsExtra.readJson(path.join(process.cwd(), 'package.json'));
        logger.log(`Current version: ${packageJson.version}`);


        packageJson.version = semver.inc(packageJson.version, releaseType);
        logger.log(`Increment version on package.json to ${packageJson.version}`);
        utils.executeCommand(`npm version ${packageJson.version} --no-commit-hooks --no-git-tag-version`);

        return packageJson.version;
    }
}
