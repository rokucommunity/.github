/**
 * This script generates the changelog for a project based on changes to it
 * and its dependencies. It should not make any changes to the repository itself.
 * Only generate the changelog for an other class to commit.
 */
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from 'brighterscript';
import * as semver from 'semver';
import fetch from 'node-fetch';
import { logger, utils } from './utils';
import { Octokit } from '@octokit/rest';

export class ChangelogGenerator {
    private tempDir = s`${__dirname}/../.tmp/.releases`;

    private options: {
        project: string;
        releaseVersion: string;
    };

    static MARKER = 'this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).';
    static HEADER = `# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).`

    public async updateChangeLog(options: ChangelogGenerator['options']) {
        logger.log(`Updating changelog for project ${options.project}`);
        logger.increaseIndent();

        logger.log('Creating tempDir', this.tempDir);
        fsExtra.emptyDirSync(this.tempDir);

        logger.log('Getting all project dependencies');
        let projects = await this.getProjectDependencies(options.project);

        logger.log(`Cloning projects: ${projects.map(x => x.name).join(', ')}`);
        for (const project of projects) {
            this.cloneProject(project);
        }

        const project = projects.filter(x => options.project.length === 0 || options.project.includes(x.name))?.at(0);

        let lastTag = this.getLastTag(project.dir);
        let latestReleaseVersion;
        if (!lastTag) {
            logger.log('Not tags were found. Set the lastTag to the first commit hash');
            lastTag = utils.executeCommandWithOutput('git rev-list --max-parents=0 HEAD', { cwd: project.dir }).toString().trim();
            latestReleaseVersion = lastTag;
        } else {
            latestReleaseVersion = lastTag.replace(/^v/, '');
        }
        logger.log(`Last release was ${lastTag}`);

        this.installDependencies(project, latestReleaseVersion);

        this.computeChanges(project, lastTag);

        if (project.changes.length === 0) {
            logger.log('Nothing has changed since last release');
            logger.decreaseIndent();
            return;
        }

        const lines = this.getChangeLogs(project, lastTag, options.releaseVersion);
        logger.log(lines)

        //assume the project running this command is the project being updated
        const changelogPath = s`CHANGELOG.md`;

        if (!fsExtra.existsSync(changelogPath)) {
            logger.log('No changelog.md file found. Creating one');
            fsExtra.outputFileSync(changelogPath, ChangelogGenerator.HEADER);
        }

        let changelog = fsExtra.readFileSync(changelogPath).toString().trim();
        if (changelog === '') {
            logger.log('No content in changelog.md file. Adding header');
            fsExtra.outputFileSync(changelogPath, ChangelogGenerator.HEADER);
        }

        const [eolChar] = /\r?\n/.exec(changelog) ?? ['\r\n'];
        changelog = changelog.replace(
            ChangelogGenerator.MARKER,
            ChangelogGenerator.MARKER + lines.join(eolChar)
        );
        fsExtra.outputFileSync(changelogPath, changelog);
        logger.decreaseIndent();
    }

    private async getProjectDependencies(projectName: string) {
        const octokit = new Octokit({
            auth: process.env.GH_TOKEN,
            request: { fetch }
        });
        logger.log(`Get all the projects from the rokucommunity org`);
        const projects = await utils.octokitPageHelper((options: any, page: number) => {
            return octokit.repos.listForOrg({
                org: 'rokucommunity',
                type: 'public',
                per_page: utils.OCTOKIT_PER_PAGE,
            });
        });
        let projectNpmNames = [];
        logger.log(`Get all avaialble package.json for each project`);
        const promises = projects.map(async x => {
            const response = await octokit.repos.getContent({
                owner: 'rokucommunity',
                repo: x.name,
                path: 'package.json',
                request: { timeout: 10000 }
            });
            // Decode Base64 content
            const content = Buffer.from((response.data as any).content, "base64").toString("utf-8");
            // Parse the cleaned string into a JSON object
            const jsonObject = JSON.parse(content);
            projectNpmNames.push({ repoName: x.name, packageName: jsonObject.name });
            this.projects.push(new Project(x.name, jsonObject.name, x.html_url));
            logger.log(`Error getting package.json for ${x.name}`);
        });
        await Promise.allSettled(promises);

        logger.log(`Get the package.json for the project ${projectName}, and find the dependencies that need to be cloned`);
        let projectPackageJson = fsExtra.readJsonSync(s`package.json`);
        let project = this.getProject(projectName);
        let projectsToClone: Project[] = [new Project(project.name)]
        Object.keys(projectPackageJson.dependencies).forEach(dependency => {
            let foundDependency = projectNpmNames.find(x => x.packageName === dependency);
            if (foundDependency) {
                projectsToClone.push(new Project(foundDependency.repoName));
                project.dependencies.push({ name: dependency, previousReleaseVersion: '', newVersion: '' });
            }
        });
        Object.keys(projectPackageJson.devDependencies).forEach(dependency => {
            let foundDependency = projectNpmNames.find(x => x.packageName === dependency);
            if (foundDependency) {
                projectsToClone.push(new Project(foundDependency.repoName));
                project.devDependencies.push({ name: dependency, previousReleaseVersion: '', newVersion: '' });
            }
        });
        projectsToClone = [...new Set(projectsToClone)];
        return projectsToClone;
    }

    /**
     * Find the year-month-day of the specified release from git logs
     */
    private getVersionDate(cwd: string, version: string) {
        const logOutput = utils.executeCommandWithOutput('git log --tags --simplify-by-decoration --pretty="format:%ci %d"', { cwd: cwd }).toString();
        const [, date] = new RegExp(String.raw`(\d+-\d+-\d+).*?tag:[ \t]*v${version.replace('.', '\\.')}`, 'gmi').exec(logOutput) ?? [];
        return date;
    }

    private isVersion(versionOrCommitHash: string) {
        return semver.valid(versionOrCommitHash);
    }

    private getChangeLogs(project: Project, lastTag: string, releaseVersion: string) {
        const [month, day, year] = new Date().toLocaleDateString().split('/');

        function getReflink(project: Project, commit: Commit, includeProjectName = false) {
            let preHashName = includeProjectName ? project.name : undefined;
            if (commit.prNumber) {
                return `[${preHashName ?? ''}#${commit.prNumber}](${project.repositoryUrl}/pull/${commit.prNumber})`;
            } else {
                preHashName = preHashName ? '#' + preHashName : '';
                return `[${preHashName}${commit.hash}](${project.repositoryUrl}/commit/${commit.hash})`;
            }
        }

        const lines = [
            '', '', '', '',
            `## [${releaseVersion}](${project.repositoryUrl}/compare/${lastTag}...v${releaseVersion}) - ${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
            `### Changed`
        ];
        //add lines for each commit since last release
        for (const commit of this.getCommitLogs(project.name, lastTag, 'HEAD')) {
            lines.push(` - ${commit.message} (${getReflink(project, commit)})`);
        }

        //build changelog entries for each new dependency
        for (const dependency of [...project.dependencies, ...project.devDependencies]) {
            if (dependency.previousReleaseVersion !== dependency.newVersion) {
                const dependencyProject = this.getProject(dependency.name);
                lines.push([
                    ` - upgrade to [${dependency.name}@${dependency.newVersion}]`,
                    `(${dependencyProject.repositoryUrl}/blob/master/CHANGELOG.md#`,
                    `${dependency.newVersion.replace(/\./g, '')}---${this.getVersionDate(dependencyProject.dir, dependency.newVersion)}). `,
                    `Notable changes since ${dependency.previousReleaseVersion}:`
                ].join(''));
                for (const commit of this.getCommitLogs(dependencyProject.name, dependency.previousReleaseVersion, dependency.newVersion)) {
                    lines.push(`     - ${commit.message} (${getReflink(dependencyProject, commit, true)})`);
                }
            }
        }

        return lines;
    }

    private getDependencyVersionFromRelease(project: Project, releaseVersion: string, packageName: string, dependencyType: 'dependencies' | 'devDependencies') {
        const ref = this.isVersion(releaseVersion) ? `v${releaseVersion}` : releaseVersion;
        const output = utils.executeCommandWithOutput(`git show ${ref}:package.json`, { cwd: project.dir }).toString();
        const packageJson = JSON.parse(output);
        const version = packageJson?.[dependencyType][packageName];
        return /\d+\.\d+\.\d+/.exec(version)?.[0] as string;
    }

    private installDependencies(project: Project, latestReleaseVersion: string) {
        logger.log('installing', project.dependencies.length, 'dependencies and', project.devDependencies.length, 'devDependencies');

        const install = (project: Project, dependencyType: 'dependencies' | 'devDependencies', flags?: string) => {
            for (const dependency of project[dependencyType]) {
                dependency.previousReleaseVersion = this.getDependencyVersionFromRelease(project, latestReleaseVersion, dependency.name, dependencyType);
                const currentVersion = fsExtra.readJsonSync(s`${project.dir}/node_modules/${dependency.name}/package.json`).version;

                utils.executeCommand(`npm install ${dependency.name}@latest`, { cwd: project.dir });

                dependency.newVersion = fsExtra.readJsonSync(s`${project.dir}/node_modules/${dependency.name}/package.json`).version;

                if (dependency.newVersion !== currentVersion) {
                    logger.log(`Updated ${dependency.name} from ${currentVersion} to ${dependency.newVersion}`);
                }
            }
        };

        install(project, 'dependencies');
        install(project, 'devDependencies', '--save-dev');
    }

    private computeChanges(project: Project, lastTag: string) {
        project.changes.push(
            ...this.getCommitLogs(project.name, lastTag, 'HEAD')
        );
        //get commits from any changed dependencies
        for (const dependency of [...project.dependencies, ...project.devDependencies]) {
            //the dependency has changed
            if (dependency.previousReleaseVersion !== dependency.newVersion) {
                project.changes.push(
                    ...this.getCommitLogs(dependency.name, dependency.previousReleaseVersion, dependency.newVersion)
                );
            }
        }
    }

    /**
     * Get the project with the specified name
     */
    private getProject(projectName: string) {
        return this.projects.find(x => x.name === projectName)!;
    }

    private getCommitLogs(projectName: string, startVersion: string, endVersion: string) {
        if (this.isVersion(startVersion)) {
            startVersion = startVersion.startsWith('v') ? startVersion : 'v' + startVersion;
        }
        let project = this.getProject(projectName);
        endVersion = endVersion.startsWith('v') || endVersion === 'HEAD' ? endVersion : 'v' + endVersion;
        const commitMessages = utils.executeCommandWithOutput(`git log ${startVersion}...${endVersion} --oneline --first-parent`, {
            cwd: project?.dir
        }).toString()
            .split(/\r?\n/g)
            //exclude empty lines
            .filter(x => x.trim())
            .map(x => {
                const [, hash, branchInfo, message, prNumber] = /\s*([a-z0-9]+)\s*(?:\((.*?)\))?\s*(.*?)\s*(?:\(#(\d+)\))?$/gm.exec(x) ?? [];
                return {
                    hash: hash,
                    branchInfo: branchInfo,
                    message: message ?? x,
                    prNumber: prNumber
                };
            })
            //exclude version-only commit messages
            .filter(x => !semver.valid(x.message))
            //exclude those "update changelog for..." message
            .filter(x => !x.message.toLowerCase().startsWith('update changelog for '));


        return commitMessages;
    }

    /**
     * Find the highest non-prerelease tag for this repository
     */
    private getLastTag(cwd: string) {
        const allTags = semver.sort(
            utils.executeCommandWithOutput(`git tag --sort version:refname`, { cwd: cwd })
                .toString()
                .split(/\r?\n/)
                .map(x => x.trim())
                //only keep valid version tags
                .filter(x => semver.valid(x))
                //exclude prerelease versions
                .filter(x => !semver.prerelease(x))
        ).reverse();

        return allTags[0];
    }

    private cloneProject(project: Project) {
        const repoName = project.name.split('/').pop();

        let url = project.repositoryUrl;
        if (!url) {
            url = `https://github.com/rokucommunity/${repoName}`;
        }

        logger.log(`Cloning ${url}`);
        project.dir = s`${this.tempDir}/${repoName}`;

        utils.executeCommand(`git clone --no-single-branch "${url}" "${project.dir}"`);
    }

    private projects: Project[] = [];
}


class Project {
    constructor(name: string, npmName?: string, repositoryUrl?: string) {
        this.name = name;
        this.npmName = npmName;
        this.repositoryUrl = repositoryUrl ?? `https://github.com/rokucommunity/${name}`;
        this.dependencies = [];
        this.devDependencies = [];
        this.changes = [];
    }

    name: string;
    /**
     * The name of the package on npm. Defaults to `project.name`
     */
    npmName: string;
    repositoryUrl: string;
    /**
     * The directory where this project is cloned.
     */
    dir: string;
    dependencies: Array<{
        name: string;
        previousReleaseVersion: string;
        newVersion: string;
    }>;
    devDependencies: Array<{
        name: string;
        previousReleaseVersion: string;
        newVersion: string;
    }>;
    /**
     * A list of changes to be included in the changelog. If non-empty, this indicates the package needs a new release
     */
    changes: Commit[];
}

interface Commit {
    hash: string;
    branchInfo: string;
    message: string;
    prNumber: string;
}
