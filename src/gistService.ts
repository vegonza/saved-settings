import * as vscode from 'vscode';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GIST_ID_KEY = 'settingsSave.gistId';
// Define filenames for the Gist
const USER_SETTINGS_FILENAME = 'settings.json';
const KEYBINDINGS_FILENAME = 'keybindings.json';
const EXTENSIONS_FILENAME = 'extensions.json';

export class GistService {
    private static instance: GistService;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public static getInstance(context: vscode.ExtensionContext): GistService {
        if (!GistService.instance) {
            GistService.instance = new GistService(context);
        }
        // Ensure context is updated if getInstance is called again with a different context
        GistService.instance.context = context;
        return GistService.instance;
    }

    // Helper function to get the VS Code user configuration directory path
    private getUserDataPath(): string {
        const platform = os.platform();
        // Read the fork folder name from configuration, default to 'Code'
        const extensionConfig = vscode.workspace.getConfiguration('settingsSave'); // Use the extension ID as section name
        const forkFolderName = extensionConfig.get<string>('forkFolderName')?.trim() || 'Code';

        if (!forkFolderName) {
            vscode.window.showWarningMessage('Fork folder name setting is empty, defaulting to "Code".');
            // Re-assign default in case trim resulted in empty string
            const defaultFolderName = 'Code';
            return this.getBaseUserDataPath(platform, defaultFolderName);
        }

        return this.getBaseUserDataPath(platform, forkFolderName);
    }

    // Helper to get the base path based on platform and folder name
    private getBaseUserDataPath(platform: string, folderName: string): string {
        switch (platform) {
            case 'win32':
                // Ensure APPDATA is available
                const appData = process.env.APPDATA;
                if (!appData) {
                    throw new Error('Environment variable APPDATA is not set.');
                }
                return path.join(appData, folderName, 'User');
            case 'darwin':
                return path.join(os.homedir(), 'Library', 'Application Support', folderName, 'User');
            case 'linux':
                return path.join(os.homedir(), '.config', folderName, 'User');
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    // Helper function to read a user config file safely
    private readUserConfigFile(fileName: string): string | null {
        try {
            const filePath = path.join(this.getUserDataPath(), fileName);
            if (fs.existsSync(filePath)) {
                return fs.readFileSync(filePath, 'utf8');
            }
            return null; // File doesn't exist
        } catch (error) {
            console.error(`Error reading ${fileName}:`, error);
            vscode.window.showWarningMessage(`Could not read ${fileName}. It will not be included in the backup.`);
            return null;
        }
    }

    private async getGitHubToken(): Promise<string> {
        try {
            const session = await vscode.authentication.getSession('github', ['gist'], { createIfNone: true });
            if (session) {
                return session.accessToken;
            } else {
                throw new Error('GitHub authentication failed.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`GitHub Authentication Error: ${error instanceof Error ? error.message : String(error)}`);
            throw error; // Re-throw the error to be caught by the command handler
        }
    }

    // Gets the content of settings.json
    private getUserSettingsContent(): string | null {
        return this.readUserConfigFile(USER_SETTINGS_FILENAME);
    }

    // Gets the content of keybindings.json
    private getKeybindingsContent(): string | null {
        return this.readUserConfigFile(KEYBINDINGS_FILENAME);
    }

    // Gets the list of installed (non-builtin) extensions
    private getInstalledExtensionsList(): string {
        const extensions = vscode.extensions.all
            .filter(extension => !extension.packageJSON.isBuiltin) // Filter out built-in extensions
            .map(extension => extension.id); // Get only the IDs
        return JSON.stringify(extensions, null, 2);
    }


    // --- Application Logic ---

    // Applies settings from the downloaded content
    private async applyUserSettings(settingsContent: string): Promise<void> {
        try {
            const settingsObject = JSON.parse(settingsContent);
            const config = vscode.workspace.getConfiguration();

            for (const key in settingsObject) {
                if (Object.prototype.hasOwnProperty.call(settingsObject, key)) {
                    const value = settingsObject[key];
                    // Use update method to apply settings globally (User scope)
                    // This is safer than overwriting settings.json directly
                    await config.update(key, value, vscode.ConfigurationTarget.Global);
                }
            }
            vscode.window.showInformationMessage('User settings applied successfully.');
        } catch (error) {
            console.error('Error applying user settings:', error);
            vscode.window.showErrorMessage(`Failed to apply user settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Applies keybindings by overwriting the keybindings.json file
    private async applyKeybindings(keybindingsContent: string): Promise<void> {
        try {
            const filePath = path.join(this.getUserDataPath(), KEYBINDINGS_FILENAME);
            fs.writeFileSync(filePath, keybindingsContent, 'utf8');
            vscode.window.showInformationMessage(`Keybindings written to ${KEYBINDINGS_FILENAME}. You might need to reload VS Code.`);
        } catch (error) {
            console.error('Error applying keybindings:', error);
            vscode.window.showErrorMessage(`Failed to write keybindings file: ${error instanceof Error ? error.message : 'Unknown error'}. Please check permissions.`);
        }
    }

    // Installs extensions from the downloaded list that are not already installed
    private async applyExtensions(extensionsContent: string): Promise<void> {
        try {
            const extensionsToInstall: string[] = JSON.parse(extensionsContent);
            const installedExtensions = vscode.extensions.all.map(ext => ext.id);
            const missingExtensions = extensionsToInstall.filter(id => !installedExtensions.includes(id));

            if (missingExtensions.length === 0) {
                vscode.window.showInformationMessage('All extensions from the backup are already installed.');
                return;
            }

            vscode.window.showInformationMessage(`Found ${missingExtensions.length} extensions to install...`);

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Installing Extensions",
                cancellable: false
            }, async (progress) => {
                for (let i = 0; i < missingExtensions.length; i++) {
                    const extensionId = missingExtensions[i];
                    progress.report({ message: `Installing ${extensionId}... (${i + 1}/${missingExtensions.length})`, increment: 100 / missingExtensions.length });
                    try {
                        await vscode.commands.executeCommand('workbench.extensions.install', extensionId);
                    } catch (installError) {
                        console.error(`Failed to install extension ${extensionId}:`, installError);
                        vscode.window.showWarningMessage(`Failed to install extension: ${extensionId}`);
                    }
                }
            });

            vscode.window.showInformationMessage('Extension installation process completed. Some installs might require a reload.');

        } catch (error) {
            console.error('Error applying extensions:', error);
            vscode.window.showErrorMessage(`Failed to apply extensions list: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // --- Upload/Download ---

    public async uploadSettings(): Promise<void> {
        try {
            const token = await this.getGitHubToken();
            const gistId = this.context.globalState.get<string>(GIST_ID_KEY);

            // Get content for each file
            const settingsContent = this.getUserSettingsContent();
            const keybindingsContent = this.getKeybindingsContent();
            const extensionsContent = this.getInstalledExtensionsList();

            // Build the files object for the Gist payload
            const files: { [key: string]: { content: string } } = {};
            if (settingsContent !== null) {
                files[USER_SETTINGS_FILENAME] = { content: settingsContent };
            }
            if (keybindingsContent !== null) {
                files[KEYBINDINGS_FILENAME] = { content: keybindingsContent };
            }
            // Always include extensions, even if empty list
            files[EXTENSIONS_FILENAME] = { content: extensionsContent };

            if (Object.keys(files).length === 0) {
                vscode.window.showWarningMessage("No settings, keybindings, or extensions found to upload.");
                return;
            }

            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            const gistPayload = {
                description: 'VS Code Settings Backup (settings, keybindings, extensions)',
                files: files
            };

            if (gistId) {
                // Update existing Gist
                await axios.patch(`https://api.github.com/gists/${gistId}`, gistPayload, { headers });
                vscode.window.showInformationMessage('Settings, Keybindings, and Extensions successfully uploaded to existing Gist!');
            } else {
                // Create new Gist
                const response = await axios.post('https://api.github.com/gists', gistPayload, { headers });
                const newGistId = response.data.id;
                await this.context.globalState.update(GIST_ID_KEY, newGistId);
                vscode.window.showInformationMessage(`Settings, Keybindings, and Extensions successfully uploaded to new Gist: ${newGistId}`);
            }
        } catch (error: any) {
            console.error('Error uploading settings:', error);
            const errorMessage = error.response?.data?.message || (error instanceof Error ? error.message : String(error));
            vscode.window.showErrorMessage(`Error uploading configurations: ${errorMessage}`);
            // Consider removing the Gist ID if the upload failed due to Gist not found or auth issues
            if (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403) {
                await this.context.globalState.update(GIST_ID_KEY, undefined);
                vscode.window.showWarningMessage('Stored Gist ID might be invalid or permission issue. Gist ID cleared.');
            }
        }
    }

    public async downloadSettings(): Promise<void> {
        try {
            const token = await this.getGitHubToken();
            const gistId = this.context.globalState.get<string>(GIST_ID_KEY);

            if (!gistId) {
                vscode.window.showInformationMessage('No Gist ID found. Please upload configurations first to create a Gist.');
                return;
            }

            const headers = {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            };

            vscode.window.showInformationMessage('Downloading configurations from Gist...');
            // Fetch the Gist
            const response = await axios.get(`https://api.github.com/gists/${gistId}`, { headers });
            const gist = response.data;

            if (!gist.files) {
                vscode.window.showErrorMessage('Gist contains no files.');
                return;
            }

            const files = gist.files;
            let appliedSomething = false;

            // Apply User Settings
            if (files[USER_SETTINGS_FILENAME] && files[USER_SETTINGS_FILENAME].content) {
                vscode.window.showInformationMessage('Applying user settings...');
                await this.applyUserSettings(files[USER_SETTINGS_FILENAME].content);
                appliedSomething = true;
            } else {
                vscode.window.showInformationMessage(`No ${USER_SETTINGS_FILENAME} found in Gist.`);
            }

            // Apply Keybindings
            if (files[KEYBINDINGS_FILENAME] && files[KEYBINDINGS_FILENAME].content) {
                vscode.window.showInformationMessage('Applying keybindings...');
                await this.applyKeybindings(files[KEYBINDINGS_FILENAME].content);
                appliedSomething = true;
            } else {
                vscode.window.showInformationMessage(`No ${KEYBINDINGS_FILENAME} found in Gist.`);
            }

            // Apply Extensions
            if (files[EXTENSIONS_FILENAME] && files[EXTENSIONS_FILENAME].content) {
                vscode.window.showInformationMessage('Checking extensions...');
                await this.applyExtensions(files[EXTENSIONS_FILENAME].content);
                appliedSomething = true;
            } else {
                vscode.window.showInformationMessage(`No ${EXTENSIONS_FILENAME} found in Gist.`);
            }

            if (appliedSomething) {
                vscode.window.showInformationMessage('Configuration download and apply process finished. You may need to reload VS Code for all changes to take effect.');
            } else {
                vscode.window.showWarningMessage('No configuration files found in the Gist to apply.');
            }

        } catch (error: any) {
            console.error('Error downloading settings:', error);
            const errorMessage = error.response?.data?.message || (error instanceof Error ? error.message : String(error));
            vscode.window.showErrorMessage(`Error downloading configurations: ${errorMessage}`);
            // Consider removing the Gist ID if the download failed due to Gist not found or auth issues
            if (error.response?.status === 404 || error.response?.status === 401 || error.response?.status === 403) {
                await this.context.globalState.update(GIST_ID_KEY, undefined);
                vscode.window.showWarningMessage('Stored Gist ID might be invalid or permission issue. Gist ID cleared.');
            }
        }
    }
} 