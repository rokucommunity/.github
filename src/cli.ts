#!/usr/bin/env node
import * as yargs from 'yargs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ReleaseCreator } from './ReleaseCreator';

let options = yargs
    .command('stage-release', 'Create a release PR', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch to create the release from' })
            .option('releaseVersion', { type: 'string', description: 'The version number to use for creating the release' })
    }, (argv) => {
        new ReleaseCreator().stageRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('upload-release', 'Upload a release to the Roku store', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch to create the release from' })
    }, (argv) => {
        new ReleaseCreator().uploadRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .argv;
