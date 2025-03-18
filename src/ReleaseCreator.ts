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
import * as diffParse from 'parse-diff';

type ReleaseType = 'major' | 'minor' | 'patch';

/**
 * This class is responsible for managing the local git repository, GitHub PRs, and GitHub Releases
**/

export class ReleaseCreator {
    private octokit: Octokit;
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
            releaseVersion: releaseVersion
        }).catch(e => {
            console.error(e);
            process.exit(1);
        });

        logger.log(`Create commit with version increment and changelog updates`);
        await this.incrementedVersion(options.releaseType as ReleaseType);
        utils.executeCommandWithOutput(`git add package.json package-lock.json CHANGELOG.md`);
        utils.executeCommandWithOutput(`git commit -m 'Increment version to ${releaseVersion}'`);
        utils.executeCommandWithOutput(`git tag v${releaseVersion} -m '${releaseVersion}'`);

        logger.log(`Push up the release branch`);
        utils.executeCommand(`git push --atomic origin release/${releaseVersion} v${releaseVersion}`);

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
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);
        if (!draftRelease) {
            throw new Error(`Release ${releaseVersion} does not exist`);
        } else if (draftRelease.draft === false) {
            throw new Error(`Release ${releaseVersion} already published`);
        }
        logger.log(`Found release ${releaseVersion}`);

        logger.log(`Get all existing release assets for ${repoName}`);
        let assets = await utils.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: repoName,
                release_id: draftRelease.id,
            });
            return result;
        });
        logger.log(`Delete all release assets for ${repoName}`);
        for (const asset of assets) {
            const deleteResponse = await this.octokit.repos.deleteReleaseAsset({
                owner: this.ORG,
                repo: repoName,
                asset_id: asset.id
            });
            logger.inLog(`delete response status: ${deleteResponse.status}`);
            if (deleteResponse.status === 204) {
                logger.inLog(`Deleted asset ${asset.name}`);
            } else {
                logger.inLog(`Failed to delete asset ${asset.name}`);
            }
        }

        logger.log(`Get artifacts from the build`)
        const artifacts = fastGlob.sync(options.artifactPaths, { absolute: false })

        logger.log(`Uploading artifacts`);
        for (const artifact of artifacts) {
            const fileName = artifact.split('/').pop();
            logger.inLog(`Uploading ${fileName}`);
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
                logger.inLog(`Uploaded asset ${fileName}`);
            } else {
                logger.inLog(`Failed to upload asset ${fileName}`);
            }
        }

        logger.log(`Get the pull request for release ${releaseVersion}`);
        const pullRequest = await this.octokit.rest.pulls.list({
            owner: this.ORG,
            repo: repoName,
            state: 'open',
            head: `release/${releaseVersion}`
        });

        logger.log(`Get the changelog file patch from the pull request`);
        const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: this.ORG,
            repo: repoName,
            pull_number: pullRequest.data[0].number
        });

        const changelogFile = files.find(f => f.filename === 'CHANGELOG.md');
        const parsedPatch = diffParse.default(changelogFile.patch);
        let lines = [];

        parsedPatch?.at(0)?.chunks.forEach(chunk => {
            chunk.changes.forEach(change => {
                // only add new lines to the patch notes
                if (change.type === 'add') {
                    lines.push(change.content.slice(1));
                }
            });
        });

        // remove the release header from the patch notes
        const regex = new RegExp(`## \\[${releaseVersion}\\]\\(.*\\) - \\d{4}-\\d{2}-\\d{2}`);
        lines = lines.filter(l => !regex.test(l));

        let patchNotes = lines.join('\n');

        // remove the changelog header from the patch notes
        if (patchNotes.startsWith(ChangelogGenerator.HEADER)) {
            patchNotes = patchNotes.slice(ChangelogGenerator.HEADER.length);
        }

        logger.log(`Changelog patch: ${patchNotes}`);

        logger.log(`Add the changelog patch notes to the release notes`);
        await this.octokit.rest.repos.updateRelease({
            owner: this.ORG,
            repo: repoName,
            release_id: draftRelease.id,
            tag_name: draftRelease.tag_name,
            body: patchNotes
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
            logger.log(`Found release ${releaseVersion}`);
        } else if (draftRelease) {
            shouldMarkAsPublished = false;
            logger.log(`Release ${releaseVersion} is not a draft`);
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
        let assets = await utils.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: repoName,
                release_id: draftRelease.id,
            });
            return result;
        });

        for (const asset of assets) {
            logger.inLog(`Release asset: ${asset.name}`);
            const assetResponse = await this.octokit.repos.getReleaseAsset({
                owner: this.ORG,
                repo: repoName,
                asset_id: asset.id,
                headers: {
                    'Accept': 'application/octet-stream'
                }
            });

            const buffer = Buffer.from(new Uint8Array(assetResponse.data as any));

            await fsExtra.writeFileSync(asset.name, buffer);
        }


        //TODO figure out how to specify the artifact to publish
        logger.log(`Publishing artifacts`);
        if (options.releaseType === 'npm') {
            logger.inLog(`Publishing ${assets[0].name} to npm`);
            // utils.executeCommand(`npm publish ${ assets[0].name }`);
        } else if (options.releaseType === 'vsce') {
            const vsceName = this.getVscePackageName();
            { //Scope for vscode
                const versions = utils.executeCommandWithOutput(`npx @vscode/vsce show ${vsceName} --json`);
                const json = JSON.parse(versions);
                if (!(json.versions.find((version: any) => version.version === releaseVersion))) {
            logger.inLog(`Publishing ${assets[0].name} to vscode`);
            // utils.executeCommand(`npx vsce publish ${ assets[0.name] }`);
            // #publish vsix to Visual Studio extension store
            // - name: Publish to VSCode extension store
            //   #exclude beta release tags
            //   if: contains(github.ref, '-beta.') == false
            //   run: npx vsce publish -p ${{env.VSCE_TOKEN}}
                }
            }
            { //Scope for open-vsx
                const response = utils.executeCommandWithOutput(`curl -s "https://open-vsx.org/api/-/query?extensionId=${vsceName}"`);
                const json = JSON.parse(response);
                const versions = json?.extensions[0]?.allVersions ?? {};
                if (!(releaseVersion in versions)) {
                    logger.inLog(`Publishing ${assets[0].name} to open-vsx`);
                    // utils.executeCommand(`npx ovsx publish -p ${{env.OPEN_VSX_TOKEN}} --debug`);
            // #pubish to OpenVSX
            // - name: Publish to OpenVSX registry
            //   #exclude beta release tags
            //   if: contains(github.ref, '-beta.') == false
            //   run: npx ovsx publish -p ${{env.OPEN_VSX_TOKEN}} --debug
                }
            }

        }

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

        try {
            logger.log(`Delete tag v${options.releaseVersion}`);
            await this.octokit.rest.git.deleteRef({
                owner: this.ORG,
                repo: repoName,
                ref: `tags/v${options.releaseVersion}`
            });
        } catch (error) {
            logger.log(`Failed to delete tag v${options.releaseVersion}`);
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

    private async getPackageName() {
        const packageJson = await fsExtra.readJson(path.join(process.cwd(), 'package.json'));
        return packageJson.name;
    }

    private async getVscePackageName() {
        const packageJson = await fsExtra.readJson(path.join(process.cwd(), 'package.json'));
        //TODO make sure publisher exists
        return `${packageJson.publisher}.${packageJson.name}`
    }


    private async listGitHubReleases(repoName: string) {
        logger.log(`Get all releases for ${repoName}`);
        const releases = await utils.octokitPageHelper((options: any, page: number) => {
            return this.octokit.rest.repos.listReleases({
                owner: this.ORG,
                repo: repoName,
                per_page: utils.OCTOKIT_PER_PAGE,
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

}
