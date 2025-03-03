import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import * as dotenv from 'dotenv';
import * as fastGlob from 'fast-glob';
import fetch from 'node-fetch';
import { option } from 'yargs';
import { logger, utils } from './utils';
import { Octokit } from '@octokit/rest';
import { ChangelogGenerator } from './ChangeLogGenerator';

type ReleaseType = 'major' | 'minor' | 'patch';

/**
 * This class is responsible for managing the local git repository, GitHub PRs, and GitHub Releases
**/

export class ReleaseCreator {
    private octokit: Octokit;
    private OCTOKIT_PER_PAGE = 100;
    private ORG = 'rokucommunity';

    constructor() {
        dotenv.config();
        utils.verbose = false;

        this.octokit = new Octokit({
            auth: process.env.GH_TOKEN,
            request: { fetch }
        });
    }

    /**
     * This method initializes a release by creating a new branch, 
     * updating the changelog and version, creating a release pull request
     * and creating a GitHub release
     */
    public async initializeRelease(options: { releaseType: ReleaseType | string, branch: string }) {
        logger.log(`Intialize release... releaseType: ${options.releaseType}, branch: ${options.branch}`);
        logger.increaseIndent();

        logger.log(`Checking for a clean repository`);
        if (!utils.executeCommandSucceeds('git diff --quiet')) {
            throw new Error('Repository is not clean');
        }

        logger.log(`Checkout branch ${options.branch}`);
        if (!utils.executeCommandSucceeds(`git checkout ${options.branch}`)) {
            throw new Error(`Branch ${options.branch} does not exist`);
        }

        logger.log(`Fetch all branches`);
        if (!utils.executeCommandSucceeds(`git fetch origin`)) {
            throw new Error(`Failed to fetch origin`);
        }

        logger.log(`Get the incremented release version`);
        const releaseVersion = await this.getNewVersion(options.releaseType as ReleaseType);

        logger.log(`Get the repository name`);
        const repoName = this.getRepositoryName();

        const releases = await this.listGitHubReleases(repoName);
        logger.log(`Check if a GitHub release already exists for ${releaseVersion}`);
        if (releases.find(r => r.tag_name === releaseVersion)) {
            throw new Error(`Release ${releaseVersion} already exists`);
        }

        logger.log(`Create new release branch release/${releaseVersion}`);
        if (!utils.executeCommandSucceeds(`git checkout -b release/${releaseVersion}`)) {
            throw new Error(`Cannot create release branch release/${releaseVersion}`);
        }

        logger.log(`Update the changelog`);
        await new ChangelogGenerator().updateChangeLog({
            project: repoName,
            test: false,
            force: false
        }).catch(e => {
            console.error(e);
            process.exit(1);
        });

        logger.log(`Create commit with version increment and changelog updates`);
        await this.incrementedVersion(options.releaseType as ReleaseType);
        utils.executeCommandWithOutput(`git add package.json package-lock.json CHANGELOG.md`);
        utils.executeCommandWithOutput(`git commit -m 'Increment version to ${releaseVersion}'`);
        utils.executeCommandWithOutput(`git tag v${releaseVersion}`);

        logger.log(`Push up the release branch`);
        utils.executeCommand(`git push origin release/${releaseVersion}`);

        logger.log(`Create GitHub release for ${releaseVersion}`);
        await this.octokit.rest.repos.createRelease({
            owner: this.ORG,
            repo: repoName,
            tag_name: `v${releaseVersion}`,
            name: releaseVersion,
            body: `Release ${releaseVersion}`,
            draft: true
        });

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

        logger.decreaseIndent();
    }

    /**
     * Replaces the release artifacts to the GitHub release
     * and add the changelog patch to the release notes
     */
    public async uploadRelease(options: { branch: string, artifactPaths: string }) {
        logger.log(`Upload release...branch: ${options.branch}`);
        logger.increaseIndent();

        logger.log(`Get the repository name`);
        const repoName = this.getRepositoryName();

        const releaseVersion = await this.getVersion();

        logger.log(`Find the existing release ${releaseVersion}`);
        const releases = await this.listGitHubReleases(repoName);
        releases.forEach(r => logger.log(`Release: ${r.tag_name}`));
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);
        if (!draftRelease) {
            throw new Error(`Release ${releaseVersion} does not exist`);
        } else if (draftRelease.draft === false) {
            throw new Error(`Release ${releaseVersion} already published`);
        }
        logger.log(`Found release ${releaseVersion}`);

        logger.log(`Get all existing release assets for ${repoName}`);
        let assets = await this.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: repoName,
                release_id: draftRelease.id,
            });
            return result;
        });
        logger.log(`Delete all release assets for ${repoName}`);
        logger.increaseIndent();
        for (const asset of assets) {
            const deleteResponse = await this.octokit.repos.deleteReleaseAsset({
                owner: this.ORG,
                repo: repoName,
                asset_id: asset.id
            });
            if (deleteResponse.status === 204) {
                logger.log(`Deleted asset ${asset.name}`);
            } else {
                logger.log(`Failed to delete asset ${asset.name}`);
            }
        }
        logger.decreaseIndent();

        logger.log(`Get artifacts from the build`)
        const artifacts = fastGlob.sync(options.artifactPaths, { absolute: false })

        logger.log(`Uploading artifacts`);
        logger.increaseIndent();
        for (const artifact of artifacts) {
            const fileName = artifact.split('/').pop();
            logger.log(`Uploading ${fileName}`);
            const uploadResponse = await this.octokit.repos.uploadReleaseAsset({
                owner: this.ORG,
                repo: repoName,
                release_id: draftRelease.id,
                name: fileName,
                data: (fsExtra.readFileSync(artifact) as unknown as string),
                headers: {
                    'content-type': 'application/octet-stream',
                    'content-length': fsExtra.statSync(artifact)
                }
            });
            if (uploadResponse.status === 201) {
                logger.log(`Uploaded asset ${fileName}`);
            } else {
                logger.log(`Failed to upload asset ${fileName}`);
            }
        }
        logger.decreaseIndent();

        logger.log(`Get the pull request for release ${releaseVersion}`);
        const pullRequest = await this.octokit.rest.pulls.list({
            owner: this.ORG,
            repo: repoName,
            state: 'open',
            head: `release/${releaseVersion}`
        });

        logger.log(`Get the changelog file patch from the pull request`);
        const pr = await this.octokit.rest.pulls.get({
            owner: this.ORG,
            repo: repoName,
            pull_number: pullRequest.data[0].number
        });

        logger.log(`Add the changelog patch to the release notes`);
        await this.octokit.rest.repos.updateRelease({
            owner: this.ORG,
            repo: repoName,
            release_id: draftRelease.id,
            body: pr.data.body
        });

        logger.decreaseIndent();
    }

    /**
     * Marks the GitHub release as published 
     * and releases the artifacts to the correct store
     */
    public async publishRelease(options: { branch: string, releaseType: string }) {
        logger.log(`publish release...branch: ${options.branch}, releaseType: ${options.releaseType}`);
        logger.increaseIndent();

        logger.log(`Get the repository name`);
        const repoName = this.getRepositoryName();

        const releaseVersion = await this.getVersion();

        logger.log(`Find the existing release ${releaseVersion}`);
        const releases = await this.listGitHubReleases(repoName);
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);
        let shouldMarkAsPublished = true;
        if (draftRelease?.draft) {
            shouldMarkAsPublished = false;
            logger.log(`Release ${releaseVersion} is not a draft`);
        } else if (draftRelease) {
            logger.log(`Found release ${releaseVersion}`);
        } else {
            throw new Error(`Release ${releaseVersion} does not exist`);
        }

        if (shouldMarkAsPublished) {
            logger.log(`Remove draft status from release ${releaseVersion}`);
            await this.octokit.rest.repos.updateRelease({
                owner: this.ORG,
                repo: repoName,
                release_id: draftRelease.id,
                draft: false
            });
        } else {
            logger.log(`Release ${releaseVersion} is already published`);
        }

        logger.log(`Get all existing release assets for ${repoName}`);
        let assets = await this.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: repoName,
                release_id: draftRelease.id,
            });
            return result;
        });

        logger.increaseIndent();
        for (const asset of assets) {
            logger.log(`Release asset: ${asset.name}`);
        }
        logger.decreaseIndent();


        //TODO figure out how to specify the artifact to publish
        logger.log(`Publishing artifacts`);
        logger.increaseIndent();
        if (options.releaseType === 'npm') {
            logger.log(`Publishing ${assets[0]} to npm`);
            // utils.executeCommand(`npm publish ${ assets[0] }`);
        } else if (options.releaseType === 'vsce') {
            logger.log(`Publishing ${assets[0]} to vscode`);
            // utils.executeCommand(`npx vsce publish ${ assets[0] }`);
        }
        logger.decreaseIndent();

        logger.decreaseIndent();
    }

    public async deleteRelease(options: { releaseVersion: string }) {
        logger.log(`Delete release...version: ${options.releaseVersion}`);
        logger.increaseIndent();

        logger.log(`Get the repository name`);
        let repoName = this.getRepositoryName();

        logger.log(`Find the existing release ${options.releaseVersion}`);
        const releases = await this.listGitHubReleases(repoName);
        let draftRelease = releases.find(r => r.tag_name === `v${options.releaseVersion}` && r.draft);
        if (draftRelease) {
            try {
                logger.log(`Deleting release ${options.releaseVersion}`);
                await this.octokit.rest.repos.deleteRelease({
                    owner: this.ORG,
                    repo: repoName,
                    release_id: draftRelease.id
                });
            } catch (error) {
                logger.log(`Failed to delete release ${options.releaseVersion}`);
            }
        }

        logger.log(`Close pull request for release ${options.releaseVersion}`);
        const pullRequest = await this.octokit.rest.pulls.list({
            owner: this.ORG,
            repo: repoName,
            state: 'open',
            head: `release/${options.releaseVersion}`
        });
        if (pullRequest.data.length > 0) {
            for (const pr of pullRequest.data) {
                try {
                    await this.octokit.rest.pulls.update({
                        owner: this.ORG,
                        repo: repoName,
                        pull_number: pr.number,
                        state: 'closed'
                    });
                    logger.log(`Closed pull request ${pr.number}`);
                } catch (error) {
                    logger.log(`Failed to close pull request ${pr.number}`);
                }
            }
        }

        try {
            logger.log(`Delete branch release/${options.releaseVersion}`);
            await this.octokit.rest.git.deleteRef({
                owner: this.ORG,
                repo: repoName,
                ref: `heads/release/${options.releaseVersion}`
            });
        } catch (error) {
            logger.log(`Failed to delete branch release/${options.releaseVersion}`);
        }
        logger.decreaseIndent();
    }

    private async getVersion() {
        const packageJson = await fsExtra.readJson(path.join(process.cwd(), 'package.json'));
        logger.log(`Current version: ${packageJson.version}`);

        return packageJson.version;
    }

    private async getNewVersion(releaseType: ReleaseType) {
        const packageJson = await fsExtra.readJson(path.join(process.cwd(), 'package.json'));
        logger.log(`Current version: ${packageJson.version}`);

        return semver.inc(packageJson.version, releaseType);
    }

    private async incrementedVersion(releaseType: ReleaseType) {
        const version = await this.getNewVersion(releaseType);
        logger.log(`Increment version on package.json to ${version}`);
        utils.executeCommand(`npm version ${version} --no-commit-hooks --no-git-tag-version`);

        return version;
    }

    private async listGitHubReleases(repoName: string) {
        logger.log(`Get all releases for ${repoName}`);
        const releases = await this.octokitPageHelper((options: any, page: number) => {
            return this.octokit.rest.repos.listReleases({
                owner: this.ORG,
                repo: repoName,
                per_page: this.OCTOKIT_PER_PAGE,
                page: page
            });
        });
        return releases;
    }

    private getRepositoryName() {
        // This is neccessary because this code is intended to run in different repositories
        const repoPath = utils.executeCommandWithOutput(`git rev-parse --show-toplevel`).trim();
        const repoName = require("path").basename(repoPath);
        logger.log(`Repository name: ${repoName}`);
        return repoName;
    }

    private async octokitPageHelper<T>(api: (options: any, page: number) => Promise<{ data: T[] }>, options = {}): Promise<T[]> {
        let getMorePages = true;
        let page = 1;
        let data: T[] = [];

        while (getMorePages) {
            let releasePage = await api(options, page);
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
