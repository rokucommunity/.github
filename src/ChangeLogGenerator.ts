/**
 * This script generates the changelog for a project based on changes to it
 * and its dependencies. It should not make any changes to the repository itself.
 * Only generate the changelog for an other class to commit.
 */
import * as fsExtra from 'fs-extra';
import { standardizePath as s } from 'brighterscript';
import * as semver from 'semver';
import { logger, utils } from './utils';

export class ChangelogGenerator {
    private tempDir = s`${__dirname}/../.tmp/.releases`;

    private options: {
        project: string;
        releaseVersion: string;
    };

    private MARKER = 'this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).';
    private HEADER = `# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).`

    public async updateChangeLog(options: ChangelogGenerator['options']) {
        logger.log(`Updating changelog for project ${options.project}`);
        logger.increaseIndent();

        logger.log('Creating tempDir', this.tempDir);
        fsExtra.emptyDirSync(this.tempDir);

        logger.log('Getting all project dependencies');
        let projects = this.getProjectDependencies(options.project);

        logger.log('Cloning projects');
        for (const project of projects) {
            this.cloneProject(project);
        }

        const project = this.projects.filter(x => options.project.length === 0 || options.project.includes(x.name))?.at(0);

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
            fsExtra.outputFileSync(changelogPath, this.HEADER);
        }

        let changelog = fsExtra.readFileSync(changelogPath).toString().trim();
        if (changelog === '') {
            logger.log('No content in changelog.md file. Adding header');
            fsExtra.outputFileSync(changelogPath, this.HEADER);
        }

        const [eolChar] = /\r?\n/.exec(changelog) ?? ['\r\n'];
        changelog = changelog.replace(
            this.MARKER,
            this.MARKER + lines.join(eolChar)
        );
        fsExtra.outputFileSync(changelogPath, changelog);
        logger.decreaseIndent();
    }

    private getProjectDependencies(projectName: string) {
        const project = this.getProject(projectName);
        const projects = [project];
        const visitedProjects = new Set<string>();

        const dfs = (current: string) => {
            const project = this.getProject(current);
            if (visitedProjects.has(current) || !project) {
                return;
            }
            visitedProjects.add(current);

            for (const dependency of [...project.dependencies, ...project.devDependencies]) {
                dfs(dependency.name);
                projects.push(this.getProject(dependency.name));
            }
        }

        dfs(projectName);
        return projects;
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
        //TODO check iv v1.0 vs 1.0
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
        endVersion = endVersion.startsWith('v') || endVersion === 'HEAD' ? endVersion : 'v' + endVersion;
        const project = this.getProject(projectName);
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

        //clone the project
        project.dir = s`${this.tempDir}/${repoName}`;
        logger.log(`Cloning ${url}`);

        utils.executeCommand(`git clone --no-single-branch "${url}" "${project.dir}"`);
    }

    private projects: Project[] = [{
        name: 'roku-deploy',
        dependencies: [],
        groups: ['vscode']
    }, {
        name: '@rokucommunity/logger',
        dependencies: [],
        groups: ['vscode']
    }, {
        name: '@rokucommunity/bslib',
        dependencies: [],
        groups: ['vscode']
    }, {
        name: 'brighterscript',
        dependencies: [
            '@rokucommunity/bslib',
            'roku-deploy'
        ],
        groups: ['vscode']
    }, {
        name: 'roku-debug',
        dependencies: [
            'brighterscript',
            '@rokucommunity/logger',
            'roku-deploy'
        ],
        groups: ['vscode']
    }, {
        name: 'brighterscript-formatter',
        dependencies: [
            'brighterscript'
        ],
        groups: ['vscode']
    }, {
        name: 'bslint',
        npmName: '@rokucommunity/bslint',
        dependencies: [],
        devDependencies: [
            'brighterscript'
        ]
    }, {
        name: 'brs',
        npmName: '@rokucommunity/brs',
        dependencies: []
    }, {
        name: 'ropm',
        dependencies: [
            'brighterscript',
            'roku-deploy'
        ]
    }, {
        name: 'roku-report-analyzer',
        dependencies: [
            '@rokucommunity/logger',
            'brighterscript'
        ]
    }, {
        name: 'vscode-brightscript-language',
        dependencies: [
            'roku-deploy',
            'roku-debug',
            'brighterscript',
            'brighterscript-formatter'
        ],
        groups: ['vscode']
    }, {
        name: 'roku-promise',
        dependencies: []
    }, {
        name: 'promises',
        npmName: '@rokucommunity/promises',
        dependencies: []
    }, {
        name: '.github',
        dependencies: []
    }, {
        name: 'release-testing',
        dependencies: []
    }].map(project => {
        const repoName = project.name.split('/').pop();
        return {
            ...project,
            dir: s`${this.tempDir}/${repoName}`,
            dependencies: project.dependencies?.map(d => ({
                name: d,
                previousReleaseVersion: undefined as any,
                newVersion: undefined as any
            })) ?? [],
            devDependencies: project.devDependencies?.map(d => ({
                name: d,
                previousReleaseVersion: undefined as any,
                newVersion: undefined as any
            })) ?? [],
            npmName: project.npmName ?? project.name,
            repositoryUrl: (project as any).repositoryUrl ?? `https://github.com/rokucommunity/${repoName}`,
            changes: []
        };
    });
}


interface Project {
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
    groups?: string[];
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
