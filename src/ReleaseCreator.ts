import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import { option } from 'yargs';
import { logger, utils } from './utils';
import { Octokit } from '@octokit/rest';

type ReleaseType = 'major' | 'minor' | 'patch';

export class ReleaseCreator {
    private token: string;

    constructor(
        private options: {
            branch: string;
            releaseVersion: string;
        }
    ) {
        this.token = process.env.GH_TOKEN || '';
    }

    async stageRelease(options: { releaseType: ReleaseType | string, branch: string }) {
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
        const releaseVersion = await this.incrementedVersion(options.releaseType as ReleaseType);

        logger.log(`Create new release branch release/${releaseVersion}`);
        if (!utils.executeCommandSucceeds(`git checkout -b release/${releaseVersion}`)) {
            throw new Error(`Cannot create release branch release/${releaseVersion}`);
        }

        logger.log(`Create commit with version increment`);
        utils.executeCommand(`git add package.json package-lock.json`);
        utils.executeCommand(`git commit -m 'Increment version to ${releaseVersion}'`);

        logger.log(`Push up the release branch`);
        utils.executeCommand(`git push origin release/${releaseVersion}`);

        logger.log(`Get the repository name`);
        // This is neccessary because this code is intended to run in different repositories
        const repoName = utils.executeCommandWithOutput(`git config --get remote.origin.url | sed -E 's/.*\\/([^/]+)\.git/\\1/'`);

        logger.log(`Create pull request`);
        logger.log(`token = ${this.token}`);
        const createResponse = await new Octokit({ auth: this.token }).rest.pulls.create({
            owner: 'rokucommunity',
            repo: repoName,
            title: releaseVersion,
            head: `release/${releaseVersion}`,
            body: `Release ${releaseVersion}`,
            base: options.branch,
            draft: true
        });

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
