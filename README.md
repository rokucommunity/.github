# Release Workflow System

This repository holds reusable and template workflows for the new release system.

## Table of Contents

- [Overview](#overview)
- [Workflow Templates](#shared-templates)
- [Reusable CI](#reusable-ci)
  - [Step 1: Stage Release](#step-1-stage-release)
  - [Step 2: Build](#step-2-build)
  - [Step 3: Publish](#step-3-publish)
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
  5. Create a pull request for review. Note, this new pull request will trigger the next step
- **Required Parameters**:
  - `branch` (target branch for the release)
  - `release_type` (e.g., major, minor, patch)
- [Stage Release Template](#) *(Placeholder for link)*

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
- [Build Template](#) *(Placeholder for link)*

### Step 3: Publish

- **Purpose**: Finalizes the release by marking it as non-draft and publishing the code.
- **Triggers**: Merging of a `release/*` branch.
- **Actions**:
  1. Mark the GitHub release as non-draft.
  2. Publish the release to users (e.g., npm, VS Code Marketplace).
- [Publish Template](#) *(Placeholder for link)*


---

## Command Line

How would the commandline work in each repository? The repos won't have the Resuable CI scripts