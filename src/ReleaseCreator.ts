import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';
import { option } from 'yargs';
import { logger, utils } from './utils';
import { Octokit } from '@octokit/rest';

type ReleaseType = 'major' | 'minor' | 'patch';

export class ReleaseCreator {
    private octokit: Octokit;
    private OCTOKIT_PER_PAGE = 100;
    private ORG = 'rokucommunity';

    constructor(
        private options: {
            branch: string;
            releaseVersion: string;
        }
    ) {
        dotenv.config();
        utils.verbose = false;

        logger.log(`Token: ${process.env.GH_TOKEN}`);
        logger.log(`Token empty check: ${process.env.GH_TOKEN !== ''}`);
        this.octokit = new Octokit({
            auth: process.env.GH_TOKEN,
            request: { fetch }
        });
    }

    async stageRelease(options: { releaseType: ReleaseType | string, branch: string }) {
        logger.log(`Staging release... releaseType: ${options.releaseType}, branch: ${options.branch}`);
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

        logger.log(`Get the repository name`);
        // This is neccessary because this code is intended to run in different repositories
        const repoPath = utils.executeCommandWithOutput(`git rev-parse --show-toplevel`).trim();
        const repoName = require("path").basename(repoPath);
        logger.log(`Repository URL: ${repoPath}`);
        logger.log(`Repository name: ${repoName}`);

        logger.log(`Get all releases for ${repoName}`);
        const releases = await this.octokitPageHelper((page: number) => {
            return this.octokit.rest.repos.listReleases({
                owner: this.ORG,
                repo: repoName,
                per_page: this.OCTOKIT_PER_PAGE,
                page: page
            });
        });

        logger.log(`Check if a GitHub release already exists for ${releaseVersion}`);
        if (releases.find(r => r.tag_name === releaseVersion)) {
            throw new Error(`Release ${releaseVersion} already exists`);
        }

        logger.log(`Create new release branch release/${releaseVersion}`);
        if (!utils.executeCommandSucceeds(`git checkout -b release/${releaseVersion}`)) {
            throw new Error(`Cannot create release branch release/${releaseVersion}`);
        }

        logger.log(`Create commit with version increment`);
        utils.executeCommand(`git add package.json package-lock.json`);
        utils.executeCommand(`git commit -m 'Increment version to ${releaseVersion}'`);

        logger.log(`Push up the release branch`);
        utils.executeCommand(`git push origin release/${releaseVersion}`);

        logger.log(`Create pull request in ${repoName}: release/${releaseVersion} -> ${options.branch}`);
        const createResponse = await this.octokit.rest.pulls.create({
            owner: this.ORG,
            repo: repoName,
            title: releaseVersion,
            head: `release/${releaseVersion}`,
            body: `Release ${releaseVersion}`,
            base: options.branch,
            draft: false
        });

        logger.log(`Create GitHub release for ${releaseVersion}`);
        await this.octokit.rest.repos.createRelease({
            owner: this.ORG,
            repo: repoName,
            tag_name: releaseVersion,
            name: releaseVersion,
            body: `Release ${releaseVersion}`,
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

    private async octokitPageHelper<T>(api: (page: number) => Promise<{ data: T[] }>, options = {}): Promise<T[]> {
        let getMorePages = true;
        let page = 1;
        let data: T[] = [];

        while (getMorePages) {
            let releasePage = await api(page);
            if (!releasePage.data) {
                break;
            }
            if (releasePage.data.length < this.OCTOKIT_PER_PAGE) {
                getMorePages = false;
            }
            data = data.concat(releasePage.data);
            page++;
        }
        return data;
    }
}
