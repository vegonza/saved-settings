# Settings Save

A Visual Studio Code extension to sync your VSCode settings with GitHub Gists using the built-in VS Code authentication.

## Features

- Upload your VS Code settings to a private GitHub Gist
- Download your VS Code settings from a GitHub Gist
- Uses VS Code's secure built-in GitHub authentication (no manual token setup needed!)

## Setup

No manual setup required! The first time you use one of the commands (Upload or Download), VS Code will prompt you to grant permission for the extension to access your GitHub account with the `gist` scope. Just follow the prompts to authorize.

## Usage

This extension provides two commands:

1.  **Upload Settings to GitHub Gist**: Uploads your current VS Code settings to a private GitHub Gist. If a Gist was previously created by this extension, it will update it. Otherwise, it creates a new one.
    - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) and search for "Upload Settings to GitHub Gist"

2.  **Download Settings from GitHub Gist**: Downloads your VS Code settings from the GitHub Gist previously created/used by this extension.
    - Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac) and search for "Download Settings from GitHub Gist"

## How it Works

- The extension uses the `vscode.authentication` API to securely obtain a GitHub OAuth token with the `gist` scope.
- It stores the ID of the Gist used for syncing in VS Code's global extension state, not in your settings file.
- Settings are currently stored as a placeholder JSON. The actual reading/writing of VS Code settings needs to be implemented in `gistService.ts` (`getVSCodeSettings` and `applyVSCodeSettings`).

## Requirements

- Visual Studio Code 1.60.0 or higher

## Extension Settings

This extension does not contribute any settings.

## Known Issues

- The actual reading and applying of VS Code settings is not yet fully implemented (placeholders exist in `gistService.ts`).

## Release Notes

### 0.0.2

- Refactored authentication to use the standard `vscode.authentication` API.
- Removed custom OAuth flow and local server.
- Storing Gist ID in global state instead of configuration.
- Updated dependencies.

### 0.0.1

- Initial release with basic commands and non-functional custom OAuth attempt. 