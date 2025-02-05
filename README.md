# Release Workflow System

This repository holds reusable and template workflows for the new release system.

## Table of Contents

- [Overview](#overview)
- [Workflow Templates](#workflow-templates)
- [Reusable CI](#reusable-ci)
  - [Step 1: Stage Release](#step-1-stage-release)
  - [Step 2: Build](#step-2-build)
  - [Step 3: Publish](#step-3-publish)
- [Repository Setup](#repository-setup)
  - [Setting Up Template Workflows in a Repository](#setting-up-template-workflows-in-a-repository)
- [Command Line](#command-line)

---

## Overview

The main CI flow consists of three key steps: **[Stage Release](#step-1-stage-release), [Build](#step-2-build), and [Publish](#step-3-publish)**. These workflows ensure a structured process for versioning, testing, and publishing new releases.

---

## Workflow Templates

Each workflow step has an associated **template** to set up workflow triggers and call the reusable workflows from the CI repository.

### Template Purposes:

- Hook into repository workflow triggers.
- Call reusable workflows in the CI repository.
- Standardize workflow execution across repositories.

---

## Reusable CI

### Step 1: Stage Release

- **Purpose**: Prepares a new release by incrementing the version and creating a release branch.
- **Triggers**: Manual dispatch with required parameters.
- **Actions**:
  1. Increment the version number.
  2. Create and checkout a new branch (`release/version`).
  3. Commit the updated version number.
  4. Open a draft GitHub release.
  5. Create a pull request for review. Note, this new pull request will trigger the next step.
- **Required Parameters**:
  - `branch` (target branch for the release)
  - `release_type` (e.g., major, minor, patch)
- [Stage Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/on-dispatch-stage-release.yml)

### Step 2: Build

- **Purpose**: Runs tests, builds the release, and uploads artifacts.
- **Triggers**: Pushes and updates to `release/*` branches.
- **Actions**:
  - **Pre-Build**:
    1. Run tests on the release branch.
    2. Validate dependencies and environment setup.
  - **Build**:
    3. Build the release artifacts.
  - **Post-Build**:
    4. Upload artifacts to the draft GitHub release.
- [Build Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/on-update-build-release.yml)

### Step 3: Publish

- **Purpose**: Finalizes the release by marking it as non-draft and publishing the code.
- **Triggers**: Merging of a `release/*` branch.
- **Actions**:
  1. Mark the GitHub release as non-draft.
  2. Publish the release to users (e.g., npm, VS Code Marketplace).
- [Publish Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/on-merge-publish-release.yml)

---

## Repository Setup

To integrate this release workflow system into a new repository, follow these steps:

1. **Add Workflow Templates**: Each repository must include the workflow templates: `on-dispatch-stage-release`, `on-update-build-release`, `on-merge-publish-release` from this repository.

  - [Setting Up Template Workflows in a Repository](#setting-up-template-workflows-in-a-repository)

     [_Example repository workflow setup_](https://github.com/rokucommunity/release-testing/tree/master/.github/workflows)

2. **Ensure Required NPM Scripts Exist**:
   - `lint`: Runs linting checks. (_Optional_)
   - `test`: Runs unit and integration tests. (_Optional_)
   - `build`: Compiles the application and outputs artifacts to `out/`.

   _Example for adding to `package.json`_
   ```json
    "scripts": {
      "lint": "echo \"Place holder for lint command\"",
      "test": "echo \"Place holder for test command\"",
      "build": "echo \"Place holder for build command\" && mkdir out && echo \"Hello World!\" > out/hello.txt"
    },
   ```
3. **Build Artifacts Location**:
   - The `build` script should place all compiled artifacts in the `out/` directory.
   - The post-build step will look for release artifacts in this directory to upload to the GitHub release.

---
### Setting Up Template Workflows in a Repository  

To integrate the release workflow system into a repository, follow these steps to add the required workflow templates from the **RokuCommunity** organization:  

### Step 1: Add Workflow Templates  
1. Navigate to your repository on GitHub.  
2. Click on the **Actions** tab.  
3. Click **New workflow** or go directly to `.github/workflows`.  
4. Under **"Choose a workflow"**, find the **By RokuCommunity** templates:  
   - **On Dispatch Stage Release**  
   - **On Update Build Release**  
   - **On Merge Publish Release**  
5. Click on each template and select **"Configure"**.  

### Step 2: Commit the Workflow Files  
1. Click **Commit changes...**.  
2. Ensure the commit is made to the default branch (master)
5. Click **Commit changes**

Once these workflows are set up, your repository will automatically follow the structured release process!

---
## Command Line

How would the command line work in each repository? The repos won't have the Reusable CI scripts.

