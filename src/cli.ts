#!/usr/bin/env node
import * as yargs from 'yargs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ReleaseCreator } from './ReleaseCreator';

let options = yargs
    .command('initialize-release', 'Initialize a release PR, draft GitHub release', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch to create the release from' })
            .option('releaseVersion', { type: 'string', description: 'The version number to use for creating the release' })
    }, (argv) => {
        if (!['major', 'minor', 'patch'].includes(argv.releaseVersion)) {
            console.error(`Invalid release version. Must be one of 'major', 'minor', or 'patch'`);
            process.exit(1);
        }
        new ReleaseCreator().initializeRelease({ branch: argv.branch, releaseType: argv.releaseVersion }).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('upload-release', 'Upload release artifacts to GitHub release', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch the release is based on' })
    }, (argv) => {
        new ReleaseCreator().uploadRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('publish-release', 'Publish GitHub release, push artifacts for public use', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch the release is based on' })
    }, (argv) => {
        new ReleaseCreator().publishRelease({ ...argv, releaseStores: [] }).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('delete-release', 'Delete GitHub release, close pull request, and delete branch', (builder) => {
        return builder
            .option('releaseVersion', { type: 'string', description: 'The version the release is based on' })
    }, (argv) => {
        new ReleaseCreator().deleteRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .argv;
